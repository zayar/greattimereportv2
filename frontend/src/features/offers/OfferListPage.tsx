import { useMutation, useQuery } from "@apollo/client";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState } from "../../components/StatusViews";
import { PageHeader } from "../../components/PageHeader";
import { Panel } from "../../components/Panel";
import type { OfferCategoryRow, OfferRow } from "../../types/domain";
import { formatDate } from "../../utils/format";
import { useAccess } from "../access/AccessProvider";
import { OfferArtworkField } from "./OfferArtworkField";
import {
  buildCreateOfferVariables,
  buildDeleteOfferVariables,
  buildOfferCategoriesVariables,
  buildOffersVariables,
  type OfferLoadScope,
  buildUpdateOfferVariables,
  CREATE_OFFER,
  DELETE_OFFER,
  GET_OFFER_CATEGORIES,
  GET_OFFERS,
  UPDATE_OFFER,
} from "./queries";
import { createOfferDraft, excerptText, sortOffersByCampaign, summarizeStatuses, type OfferDraft } from "./offerUtils";

type OffersResponse = {
  offers: OfferRow[];
};

type OfferCategoriesResponse = {
  offerCategories: OfferCategoryRow[];
};

type MutationResponse = {
  createOneOffer?: { id: string };
  updateOneOffer?: { id: string };
  deleteOneOffer?: { id: string };
};

type EditorMode =
  | { type: "new" }
  | { type: "existing"; id: string };

export function OfferListPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [scope, setScope] = useState<OfferLoadScope>("month");
  const [mode, setMode] = useState<EditorMode>({ type: "new" });
  const [draft, setDraft] = useState<OfferDraft>(() => createOfferDraft());
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);

  const offersQuery = useQuery<OffersResponse>(GET_OFFERS, {
    variables: currentClinic ? buildOffersVariables(currentClinic.id, scope) : undefined,
    skip: !currentClinic,
  });
  const categoriesQuery = useQuery<OfferCategoriesResponse>(GET_OFFER_CATEGORIES, {
    variables: currentClinic ? buildOfferCategoriesVariables(currentClinic.id) : undefined,
    skip: !currentClinic,
  });

  const [createOffer, { loading: creating }] = useMutation<MutationResponse>(CREATE_OFFER);
  const [updateOffer, { loading: updating }] = useMutation<MutationResponse>(UPDATE_OFFER);
  const [deleteOffer, { loading: deleting }] = useMutation<MutationResponse>(DELETE_OFFER);

  const allRows = offersQuery.data?.offers ?? [];
  const categories = categoriesQuery.data?.offerCategories ?? [];
  const rows = useMemo(() => {
    return sortOffersByCampaign(
      allRows.filter((row) => {
        if (statusFilter && row.status !== statusFilter) {
          return false;
        }

        if (categoryFilter && (row.category?.id ?? row.category_id ?? "") !== categoryFilter) {
          return false;
        }

        if (!deferredSearch) {
          return true;
        }

        const haystack = [
          row.name,
          row.category?.name ?? "",
          row.hight_light ?? "",
          row.description ?? "",
          row.term_and_condition ?? "",
        ]
          .join(" ")
          .toLowerCase();

        return haystack.includes(deferredSearch);
      }),
    );
  }, [allRows, categoryFilter, deferredSearch, statusFilter]);

  const selectedRow = mode.type === "existing" ? allRows.find((row) => row.id === mode.id) ?? null : null;
  const statusSummary = useMemo(() => summarizeStatuses(allRows), [allRows]);
  const illustratedCount = useMemo(() => allRows.filter((row) => Boolean(row.image)).length, [allRows]);
  const categoryCoverage = useMemo(
    () => new Set(allRows.map((row) => row.category?.id).filter(Boolean)).size,
    [allRows],
  );
  const scopeLabel = scope === "month" ? "This month" : "All campaigns";
  const scopeHint =
    scope === "month"
      ? "Only this month's offers are loaded first so the gallery opens faster."
      : "Showing the full campaign archive for this clinic.";

  useEffect(() => {
    if (allRows.length === 0) {
      setMode({ type: "new" });
      setDraft(createOfferDraft());
      return;
    }

    if (mode.type === "existing") {
      const nextSelected = allRows.find((row) => row.id === mode.id);
      if (nextSelected) {
        setDraft(createOfferDraft(nextSelected));
        return;
      }
    }

    if (mode.type === "new") {
      return;
    }

    const firstRow = allRows[0];
    setMode({ type: "existing", id: firstRow.id });
    setDraft(createOfferDraft(firstRow));
  }, [allRows, mode]);

  const busy = creating || updating || deleting;
  const currentCategoryName =
    categories.find((category) => category.id === draft.category_id)?.name || "Uncategorized";

  function selectExisting(row: OfferRow) {
    setMode({ type: "existing", id: row.id });
    setDraft(createOfferDraft(row));
    setFeedback(null);
  }

  function beginCreate() {
    setMode({ type: "new" });
    setDraft(createOfferDraft());
    setFeedback(null);
  }

  async function handleSave() {
    if (!currentClinic) {
      return;
    }

    if (!draft.name.trim()) {
      setFeedback({ tone: "error", message: "Offer name is required." });
      return;
    }

    try {
      if (mode.type === "new") {
        const result = await createOffer({
          variables: buildCreateOfferVariables(currentClinic.id, draft),
        });
        const createdId = result.data?.createOneOffer?.id;

        await offersQuery.refetch();

        if (createdId) {
          setMode({ type: "existing", id: createdId });
        }

        setFeedback({ tone: "success", message: "Offer created." });
        return;
      }

      await updateOffer({
        variables: buildUpdateOfferVariables(mode.id, draft),
      });
      await offersQuery.refetch();
      setFeedback({ tone: "success", message: "Offer updated." });
    } catch (mutationError) {
      setFeedback({
        tone: "error",
        message: mutationError instanceof Error ? mutationError.message : "Could not save the offer.",
      });
    }
  }

  async function handleDelete() {
    if (mode.type !== "existing") {
      return;
    }

    if (!window.confirm(`Delete "${selectedRow?.name ?? "this offer"}"?`)) {
      return;
    }

    try {
      await deleteOffer({
        variables: buildDeleteOfferVariables(mode.id),
      });
      await offersQuery.refetch();
      setMode({ type: "new" });
      setDraft(createOfferDraft());
      setFeedback({ tone: "success", message: "Offer deleted." });
    } catch (mutationError) {
      setFeedback({
        tone: "error",
        message: mutationError instanceof Error ? mutationError.message : "Could not delete the offer.",
      });
    }
  }

  function resetEditor() {
    if (selectedRow) {
      setDraft(createOfferDraft(selectedRow));
      setFeedback(null);
      return;
    }

    setDraft(createOfferDraft());
    setFeedback(null);
  }

  return (
    <div className="page-stack page-stack--workspace analytics-report internal-workspace internal-workspace--soft offer-admin offer-admin--offers">
      <PageHeader
        title="Offer List"
        actions={
          <div className="offer-admin__toolbar offer-admin__toolbar--offers">
            <div className="offer-admin__scope-switch" role="group" aria-label="Offer gallery scope">
              <button
                type="button"
                className={`button ${scope === "month" ? "" : "button--secondary"}`.trim()}
                onClick={() => setScope("month")}
              >
                This month
              </button>
              <button
                type="button"
                className={`button ${scope === "all" ? "" : "button--secondary"}`.trim()}
                onClick={() => setScope("all")}
              >
                All time
              </button>
            </div>
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Offer name, highlight, description"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <label className="field field--compact">
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>
            <label className="field field--compact">
              <span>Category</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                <option value="">All categories</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="button button--secondary" onClick={beginCreate}>
              New Offer
            </button>
          </div>
        }
      />

      <div className="report-kpi-strip">
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Offers</span>
          <strong className="report-kpi-strip__value">{allRows.length.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">All offers currently stored for the selected clinic.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Active</span>
          <strong className="report-kpi-strip__value">{statusSummary.active.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Offers that are ready to surface in the customer experience.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">With cover image</span>
          <strong className="report-kpi-strip__value">{illustratedCount.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Offers with artwork already attached.</span>
        </article>
        <article className="report-kpi-strip__card">
          <span className="report-kpi-strip__label">Categories used</span>
          <strong className="report-kpi-strip__value">{categoryCoverage.toLocaleString("en-US")}</strong>
          <span className="report-kpi-strip__hint">Distinct categories represented across the offer list.</span>
        </article>
      </div>

      <div className="offer-admin__layout offer-admin__layout--offers">
        <Panel
          className="offer-admin__list-panel"
          title="Offer gallery"
          subtitle={`${rows.length.toLocaleString("en-US")} offer cards in ${scopeLabel.toLowerCase()} view`}
        >
          <div className="offer-admin__gallery-banner">
            <div className="offer-admin__gallery-copy">
              <span className="offer-admin__eyebrow">Campaign focus</span>
              <strong>{scopeLabel} offers first</strong>
              <p>{scopeHint}</p>
            </div>
            <div className="offer-admin__gallery-stats">
              <span>{allRows.length.toLocaleString("en-US")} loaded</span>
              <span>{rows.length.toLocaleString("en-US")} visible</span>
            </div>
          </div>

          {offersQuery.loading || categoriesQuery.loading ? (
            <div className="inline-note inline-note--loading">Loading offers...</div>
          ) : null}
          {offersQuery.error ? <ErrorState label="Offers could not be loaded" detail={offersQuery.error.message} /> : null}
          {categoriesQuery.error ? (
            <ErrorState label="Offer categories could not be loaded" detail={categoriesQuery.error.message} />
          ) : null}
          {!offersQuery.loading && !offersQuery.error && rows.length === 0 ? (
            <EmptyState label="No offers matched these filters" detail="Try clearing the filters or create a new offer." />
          ) : null}

          {rows.length > 0 ? (
            <div className="offer-admin__card-grid offer-admin__card-grid--offers">
              {rows.map((row, index) => {
                const selected = mode.type === "existing" && mode.id === row.id;
                const featured = index === 0;

                return (
                  <button
                    key={row.id}
                    type="button"
                    className={`offer-card offer-card--offer ${selected ? "offer-card--selected" : ""} ${featured ? "offer-card--featured" : ""}`.trim()}
                    onClick={() => selectExisting(row)}
                  >
                    <div className="offer-card__media">
                      {featured ? <span className="offer-card__badge">Latest campaign</span> : null}
                      {row.image ? <img src={row.image} alt={row.name} /> : <span>Offer Artwork</span>}
                    </div>
                    <div className="offer-card__body">
                      <div className="offer-card__meta">
                        <span className={`status-pill ${(row.status ?? "").toUpperCase() === "ACTIVE" ? "status-pill--active" : "status-pill--archived"}`}>
                          {row.status}
                        </span>
                        <span>{row.category?.name || "Uncategorized"}</span>
                      </div>
                      <strong>{row.name}</strong>
                      <p>{excerptText(row.hight_light || row.description, 110)}</p>
                      <div className="offer-card__footer">
                        <span>Sort {Number(row.sort_order ?? 0)}</span>
                        <span>Created {formatDate(row.created_at)}</span>
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
          title={mode.type === "new" ? "Create offer" : "Edit offer"}
          subtitle="Shape the image, highlight, and long-form copy together so the offer feels intentional before it goes live."
        >
          {feedback ? (
            <div className={`offer-admin__feedback offer-admin__feedback--${feedback.tone}`}>{feedback.message}</div>
          ) : null}

          <div className="offer-editor">
            <div className="offer-preview-card">
              <div className="offer-preview-card__media">
                {draft.image ? <img src={draft.image} alt={draft.name || "Offer preview"} /> : <span>Offer Preview</span>}
              </div>
              <div className="offer-preview-card__body">
                <div className="offer-preview-card__meta">
                  <span className={`status-pill ${draft.status === "ACTIVE" ? "status-pill--active" : "status-pill--archived"}`}>
                    {draft.status}
                  </span>
                  <span>{currentCategoryName}</span>
                </div>
                <strong>{draft.name || "Untitled offer"}</strong>
                <p>{excerptText(draft.hight_light || draft.description, 150)}</p>
              </div>
            </div>

            <OfferArtworkField
              clinicId={currentClinic?.id ?? "draft"}
              label="Offer cover image"
              hint="Use a bright, clean image that still reads well when cropped into a small card."
              value={draft.image}
              onChange={(image) => setDraft((previous) => ({ ...previous, image }))}
            />

            <div className="offer-editor__grid offer-editor__grid--three">
              <label className="field">
                <span>Name</span>
                <input
                  type="text"
                  value={draft.name}
                  placeholder="Example: Valentine's Special"
                  onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))}
                />
              </label>

              <label className="field">
                <span>Category</span>
                <select
                  value={draft.category_id}
                  onChange={(event) => setDraft((previous) => ({ ...previous, category_id: event.target.value }))}
                >
                  <option value="">No category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
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

              <label className="field">
                <span>Expired Date</span>
                <input
                  type="date"
                  value={draft.expired_date}
                  onChange={(event) => setDraft((previous) => ({ ...previous, expired_date: event.target.value }))}
                />
              </label>
            </div>

            <label className="field offer-editor__field">
              <span>Highlight</span>
              <textarea
                rows={4}
                value={draft.hight_light}
                placeholder="Write the short hook that will stand out on the offer card."
                onChange={(event) => setDraft((previous) => ({ ...previous, hight_light: event.target.value }))}
              />
            </label>

            <label className="field offer-editor__field">
              <span>Description</span>
              <textarea
                rows={6}
                value={draft.description}
                placeholder="Explain the experience, treatment combination, or customer benefit in more detail."
                onChange={(event) => setDraft((previous) => ({ ...previous, description: event.target.value }))}
              />
            </label>

            <label className="field offer-editor__field">
              <span>Terms &amp; Conditions</span>
              <textarea
                rows={5}
                value={draft.term_and_condition}
                placeholder="Add validity, exclusions, redemption rules, or booking restrictions."
                onChange={(event) =>
                  setDraft((previous) => ({ ...previous, term_and_condition: event.target.value }))
                }
              />
            </label>

            <div className="offer-editor__actions">
              <button type="button" className="button" disabled={busy} onClick={() => void handleSave()}>
                {busy ? "Saving..." : mode.type === "new" ? "Create Offer" : "Save Changes"}
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
