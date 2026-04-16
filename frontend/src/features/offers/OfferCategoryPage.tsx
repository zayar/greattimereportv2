import { useMutation, useQuery } from "@apollo/client";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState } from "../../components/StatusViews";
import { PageHeader } from "../../components/PageHeader";
import { Panel } from "../../components/Panel";
import { formatDate } from "../../utils/format";
import type { OfferCategoryRow } from "../../types/domain";
import { useAccess } from "../access/AccessProvider";
import { OfferArtworkField } from "./OfferArtworkField";
import {
  buildCreateOfferCategoryVariables,
  buildDeleteOfferCategoryVariables,
  buildOfferCategoriesVariables,
  buildUpdateOfferCategoryVariables,
  CREATE_OFFER_CATEGORY,
  DELETE_OFFER_CATEGORY,
  GET_OFFER_CATEGORIES,
  UPDATE_OFFER_CATEGORY,
} from "./queries";
import { createOfferCategoryDraft, excerptText, summarizeStatuses, type OfferCategoryDraft } from "./offerUtils";

type OfferCategoriesResponse = {
  offerCategories: OfferCategoryRow[];
};

type MutationResponse = {
  createOneOfferCategory?: { id: string };
  updateOneOfferCategory?: { id: string };
  deleteOneOfferCategory?: { id: string };
};

type EditorMode =
  | { type: "new" }
  | { type: "existing"; id: string };

export function OfferCategoryPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [mode, setMode] = useState<EditorMode>({ type: "new" });
  const [draft, setDraft] = useState<OfferCategoryDraft>(() => createOfferCategoryDraft());
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  const { data, loading, error, refetch } = useQuery<OfferCategoriesResponse>(GET_OFFER_CATEGORIES, {
    variables: currentClinic ? buildOfferCategoriesVariables(currentClinic.id) : undefined,
    skip: !currentClinic,
  });
  const [createCategory, { loading: creating }] = useMutation<MutationResponse>(CREATE_OFFER_CATEGORY);
  const [updateCategory, { loading: updating }] = useMutation<MutationResponse>(UPDATE_OFFER_CATEGORY);
  const [deleteCategory, { loading: deleting }] = useMutation<MutationResponse>(DELETE_OFFER_CATEGORY);

  const allRows = data?.offerCategories ?? [];
  const rows = useMemo(() => {
    if (!deferredSearch) {
      return allRows;
    }

    return allRows.filter((row) => {
      const haystack = [row.name, row.description ?? ""].join(" ").toLowerCase();
      return haystack.includes(deferredSearch);
    });
  }, [allRows, deferredSearch]);

  const selectedRow = mode.type === "existing" ? allRows.find((row) => row.id === mode.id) ?? null : null;
  const statusSummary = useMemo(() => summarizeStatuses(allRows), [allRows]);
  const illustratedCount = useMemo(() => allRows.filter((row) => Boolean(row.image)).length, [allRows]);

  useEffect(() => {
    if (allRows.length === 0) {
      setMode({ type: "new" });
      setDraft(createOfferCategoryDraft());
      return;
    }

    if (mode.type === "existing") {
      const nextSelected = allRows.find((row) => row.id === mode.id);
      if (nextSelected) {
        setDraft(createOfferCategoryDraft(nextSelected));
        return;
      }
    }

    if (mode.type === "new") {
      return;
    }

    const firstRow = allRows[0];
    setMode({ type: "existing", id: firstRow.id });
    setDraft(createOfferCategoryDraft(firstRow));
  }, [allRows, mode]);

  const busy = creating || updating || deleting;

  function selectExisting(row: OfferCategoryRow) {
    setMode({ type: "existing", id: row.id });
    setDraft(createOfferCategoryDraft(row));
    setFeedback(null);
  }

  function beginCreate() {
    setMode({ type: "new" });
    setDraft(createOfferCategoryDraft());
    setFeedback(null);
  }

  async function handleSave() {
    if (!currentClinic) {
      return;
    }

    if (!draft.name.trim()) {
      setFeedback({ tone: "error", message: "Category name is required." });
      return;
    }

    try {
      if (mode.type === "new") {
        const result = await createCategory({
          variables: buildCreateOfferCategoryVariables(currentClinic.id, draft),
        });
        const createdId = result.data?.createOneOfferCategory?.id;

        await refetch();

        if (createdId) {
          setMode({ type: "existing", id: createdId });
        }

        setFeedback({ tone: "success", message: "Offer category created." });
        return;
      }

      await updateCategory({
        variables: buildUpdateOfferCategoryVariables(mode.id, draft),
      });
      await refetch();
      setFeedback({ tone: "success", message: "Offer category updated." });
    } catch (mutationError) {
      setFeedback({
        tone: "error",
        message: mutationError instanceof Error ? mutationError.message : "Could not save the category.",
      });
    }
  }

  async function handleDelete() {
    if (mode.type !== "existing") {
      return;
    }

    if (!window.confirm(`Delete "${selectedRow?.name ?? "this category"}"?`)) {
      return;
    }

    try {
      await deleteCategory({
        variables: buildDeleteOfferCategoryVariables(mode.id),
      });
      await refetch();
      setMode({ type: "new" });
      setDraft(createOfferCategoryDraft());
      setFeedback({ tone: "success", message: "Offer category deleted." });
    } catch (mutationError) {
      setFeedback({
        tone: "error",
        message:
          mutationError instanceof Error
            ? mutationError.message
            : "Could not delete the category. Remove linked offers first if needed.",
      });
    }
  }

  function resetEditor() {
    if (selectedRow) {
      setDraft(createOfferCategoryDraft(selectedRow));
      setFeedback(null);
      return;
    }

    setDraft(createOfferCategoryDraft());
    setFeedback(null);
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report internal-workspace internal-workspace--soft offer-admin offer-admin--categories">
      <PageHeader
        title="Offer Category"
        actions={
          <div className="offer-admin__toolbar">
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Category name or description"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button type="button" className="button button--secondary" onClick={beginCreate}>
              New Category
            </button>
          </div>
        }
      />

      <div className="report-kpi-strip">
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Categories</span>
          <strong className="report-kpi-strip__value">{allRows.length.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">All offer category records for the selected clinic.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Active</span>
          <strong className="report-kpi-strip__value">{statusSummary.active.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Categories currently available to publish under.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">With artwork</span>
          <strong className="report-kpi-strip__value">{illustratedCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Categories already carrying a visual cover image.</span>
        </article>
      </div>

      <div className="offer-admin__layout">
        <Panel
          className="offer-admin__list-panel"
          title="Category library"
          subtitle={`${rows.length.toLocaleString("en-US")} category cards in the current filter`}
        >
          {loading ? <div className="inline-note inline-note--loading">Loading offer categories...</div> : null}
          {error ? <ErrorState label="Offer categories could not be loaded" detail={error.message} /> : null}
          {!loading && !error && rows.length === 0 ? (
            <EmptyState label="No offer categories matched this search" detail="Try clearing the search or add a new category." />
          ) : null}

          {rows.length > 0 ? (
            <div className="offer-admin__card-grid offer-admin__card-grid--categories">
              {rows.map((row) => {
                const selected = mode.type === "existing" && mode.id === row.id;

                return (
                  <button
                    key={row.id}
                    type="button"
                    className={`offer-card offer-card--category ${selected ? "offer-card--selected" : ""}`.trim()}
                    onClick={() => selectExisting(row)}
                  >
                    <div className="offer-card__media offer-card__media--compact">
                      {row.image ? <img src={row.image} alt={row.name} /> : <span>Category Artwork</span>}
                    </div>
                    <div className="offer-card__body">
                      <div className="offer-card__meta">
                        <span className={`status-pill ${(row.status ?? "").toUpperCase() === "ACTIVE" ? "status-pill--active" : "status-pill--archived"}`}>
                          {row.status}
                        </span>
                        <span>Sort {Number(row.sort_order ?? 0)}</span>
                      </div>
                      <strong>{row.name}</strong>
                      <p>{excerptText(row.description, 100)}</p>
                      <div className="offer-card__footer">
                        <span>{formatDate(row.created_at)}</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </Panel>

        <Panel
          className="offer-admin__editor-panel"
          title={mode.type === "new" ? "Create category" : "Edit category"}
          subtitle="Keep the category artwork and copy tight so offer cards feel polished and scannable."
        >
          {feedback ? (
            <div className={`offer-admin__feedback offer-admin__feedback--${feedback.tone}`}>{feedback.message}</div>
          ) : null}

          <div className="offer-editor">
            <OfferArtworkField
              clinicId={currentClinic?.id ?? "draft"}
              label="Category artwork"
              hint="This image becomes the visual anchor for offers grouped under this category."
              value={draft.image}
              onChange={(image) => setDraft((previous) => ({ ...previous, image }))}
            />

            <div className="offer-editor__grid offer-editor__grid--two">
              <label className="field">
                <span>Name</span>
                <input
                  type="text"
                  value={draft.name}
                  placeholder="Example: Hair Color"
                  onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))}
                />
              </label>

              <label className="field">
                <span>Status</span>
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      status: event.target.value === "INACTIVE" ? "INACTIVE" : "ACTIVE",
                    }))
                  }
                >
                  <option value="ACTIVE">Active</option>
                  <option value="INACTIVE">Inactive</option>
                </select>
              </label>

              <label className="field">
                <span>Sort Order</span>
                <input
                  type="number"
                  min={0}
                  value={draft.sort_order}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      sort_order: Number(event.target.value || 0),
                    }))
                  }
                />
              </label>
            </div>

            <label className="field offer-editor__field">
              <span>Description</span>
              <textarea
                rows={6}
                value={draft.description}
                placeholder="Describe what this category is used for and what kind of offers belong here."
                onChange={(event) => setDraft((previous) => ({ ...previous, description: event.target.value }))}
              />
            </label>

            <div className="offer-editor__actions">
              <button type="button" className="button" disabled={busy} onClick={() => void handleSave()}>
                {busy ? "Saving..." : mode.type === "new" ? "Create Category" : "Save Changes"}
              </button>
              <button type="button" className="button button--secondary" disabled={busy} onClick={resetEditor}>
                Reset
              </button>
              {mode.type === "existing" ? (
                <button type="button" className="button button--ghost" disabled={busy} onClick={() => void handleDelete()}>
                  Delete
                </button>
              ) : null}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
