import { createHash } from "node:crypto";
import { firestoreDb } from "../../config/firebase.js";
import { nowIso } from "../agent-hub/safety.js";
import {
  consultantServiceKnowledgeSchema,
  isConsultantKnowledgePublishable,
  type ConsultantKnowledgeContent,
  type ConsultantServiceKnowledge,
} from "./service-knowledge.schemas.js";

const KNOWLEDGE_COLLECTION = "gtConsultantServiceKnowledgeV1";
const KNOWLEDGE_VERSIONS_COLLECTION = "gtConsultantServiceKnowledgeVersionsV1";
const MAX_KNOWLEDGE_DOCUMENTS_PER_CLINIC = 500;

export class ConsultantKnowledgeVersionConflictError extends Error {
  constructor() {
    super("The service knowledge changed after it was opened. Reload it before saving again.");
    this.name = "ConsultantKnowledgeVersionConflictError";
  }
}

export class ConsultantKnowledgeNotReadyError extends Error {
  constructor() {
    super(
      "Before publishing, complete an overview, concern tags, suitability or benefits, a safety boundary, and consultation questions in at least one language.",
    );
    this.name = "ConsultantKnowledgeNotReadyError";
  }
}

function knowledgeDocumentId(clinicId: string, serviceId: string) {
  return createHash("sha256").update(`${clinicId}:${serviceId}`).digest("hex");
}

function knowledgeRef(clinicId: string, serviceId: string) {
  return firestoreDb().collection(KNOWLEDGE_COLLECTION).doc(knowledgeDocumentId(clinicId, serviceId));
}

function versionRef(knowledgeId: string, version: number) {
  return firestoreDb()
    .collection(KNOWLEDGE_VERSIONS_COLLECTION)
    .doc(`${knowledgeId}__${String(version).padStart(8, "0")}`);
}

function parseKnowledge(data: FirebaseFirestore.DocumentData | undefined) {
  const parsed = consultantServiceKnowledgeSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function getConsultantServiceKnowledge(params: {
  clinicId: string;
  serviceId: string;
}) {
  const snapshot = await knowledgeRef(params.clinicId, params.serviceId).get();
  return parseKnowledge(snapshot.data());
}

export async function listConsultantServiceKnowledge(params: {
  clinicId: string;
  publishedOnly?: boolean;
}) {
  const snapshot = await firestoreDb()
    .collection(KNOWLEDGE_COLLECTION)
    .where("clinicId", "==", params.clinicId)
    .limit(MAX_KNOWLEDGE_DOCUMENTS_PER_CLINIC)
    .get();

  return snapshot.docs
    .map((document) => parseKnowledge(document.data()))
    .filter((knowledge): knowledge is ConsultantServiceKnowledge => Boolean(knowledge))
    .filter((knowledge) => !params.publishedOnly || (knowledge.status === "published" && knowledge.publishedContent))
    .sort((left, right) => left.serviceName.localeCompare(right.serviceName));
}

export async function saveConsultantKnowledgeDraft(params: {
  clinicId: string;
  clinicCode: string;
  serviceId: string;
  serviceName: string;
  content: ConsultantKnowledgeContent;
  expectedVersion?: number | null;
  actor: { userId: string; email?: string | null };
}) {
  const documentId = knowledgeDocumentId(params.clinicId, params.serviceId);
  const documentRef = knowledgeRef(params.clinicId, params.serviceId);

  return firestoreDb().runTransaction(async (transaction) => {
    const existingSnapshot = await transaction.get(documentRef);
    const existing = parseKnowledge(existingSnapshot.data());

    if (
      params.expectedVersion != null &&
      (!existing || existing.version !== params.expectedVersion)
    ) {
      throw new ConsultantKnowledgeVersionConflictError();
    }

    if (existing && params.expectedVersion == null) {
      throw new ConsultantKnowledgeVersionConflictError();
    }

    const updatedAt = nowIso();
    const version = (existing?.version ?? 0) + 1;
    const knowledge: ConsultantServiceKnowledge = {
      id: documentId,
      clinicId: params.clinicId,
      clinicCode: params.clinicCode,
      serviceId: params.serviceId,
      serviceName: params.serviceName,
      content: params.content,
      publishedContent: existing?.publishedContent ?? null,
      status: existing?.publishedContent ? "published" : "draft",
      version,
      publishedVersion: existing?.publishedVersion ?? null,
      createdAt: existing?.createdAt ?? updatedAt,
      createdBy: existing?.createdBy ?? params.actor.userId,
      createdByEmail: existing?.createdByEmail ?? params.actor.email ?? null,
      updatedAt,
      updatedBy: params.actor.userId,
      updatedByEmail: params.actor.email ?? null,
      publishedAt: existing?.publishedAt ?? null,
      publishedBy: existing?.publishedBy ?? null,
      publishedByEmail: existing?.publishedByEmail ?? null,
    };

    transaction.set(documentRef, knowledge);
    transaction.set(versionRef(documentId, version), {
      ...knowledge,
      action: "draft_saved",
      recordedAt: updatedAt,
    });

    return knowledge;
  });
}

export async function publishConsultantServiceKnowledge(params: {
  clinicId: string;
  serviceId: string;
  expectedVersion: number;
  actor: { userId: string; email?: string | null };
}) {
  const documentRef = knowledgeRef(params.clinicId, params.serviceId);

  return firestoreDb().runTransaction(async (transaction) => {
    const existingSnapshot = await transaction.get(documentRef);
    const existing = parseKnowledge(existingSnapshot.data());

    if (!existing || existing.version !== params.expectedVersion) {
      throw new ConsultantKnowledgeVersionConflictError();
    }

    if (!isConsultantKnowledgePublishable(existing.content)) {
      throw new ConsultantKnowledgeNotReadyError();
    }

    const publishedAt = nowIso();
    const version = existing.version + 1;
    const knowledge: ConsultantServiceKnowledge = {
      ...existing,
      publishedContent: existing.content,
      status: "published",
      version,
      publishedVersion: version,
      updatedAt: publishedAt,
      updatedBy: params.actor.userId,
      updatedByEmail: params.actor.email ?? null,
      publishedAt,
      publishedBy: params.actor.userId,
      publishedByEmail: params.actor.email ?? null,
    };

    transaction.set(documentRef, knowledge);
    transaction.set(versionRef(existing.id, version), {
      ...knowledge,
      action: "published",
      recordedAt: publishedAt,
    });

    return knowledge;
  });
}
