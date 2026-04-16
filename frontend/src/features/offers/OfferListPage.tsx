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
import {
  createOfferDraft,
  excerptText,
  filterOffers,
  getOfferSortOrderOptions,
  sortOffersByCampaign,
  summarizeStatuses,
  type OfferDraft,
} from "./offerUtils";

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

type CreatedSortDirection = "desc" | "asc";

export function OfferListPage() {
  const { currentClinic } = useAccess();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search.trim().toLowerCase());
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [sortOrderFilter, setSortOrderFilter] = useState("");
  const [scope, setScope] = useState<OfferLoadScope>("month");
  const [createdSortDirection, setCreatedSortDirection] = useState<CreatedSortDirection>("desc");
  const [editorOpen, setEditorOpen] = useState(false);
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
  const sortedAllRows = useMemo(
    () => sortOffersByCampaign(allRows, createdSortDirection),
    [allRows, createdSortDirection],
  );
  const categories = categoriesQuery.data?.offerCategories ?? [];
  const sortOrderOptions = useMemo(() => getOfferSortOrderOptions(sortedAllRows), [sortedAllRows]);
  const rows = useMemo(() => {
    return filterOffers(sortedAllRows, {
      status: statusFilter,
      categoryId: categoryFilter,
      search: deferredSearch,
      sortOrder: sortOrderFilter,
    });
  }, [categoryFilter, deferredSearch, sortedAllRows, sortOrderFilter, statusFilter]);

  const selectedRow = mode.type === "existing" ? allRows.find((row) => row.id === mode.id) ?? null : null;
  const statusSummary = useMemo(() => summarizeStatuses(allRows), [allRows]);
  const scopeLabel = scope === "month" ? "This month" : "All campaigns";
  const selectedCountLabel =
    rows.length === allRows.length ? `${rows.length.toLocaleString("en-US")} visible` : `${rows.length.toLocaleString("en-US")} filtered`;
  const createdSortLabel = createdSortDirection === "desc" ? "Newest first" : "Oldest first";
  const busy = creating || updating || deleting;

  useEffect(() => {
    setEditorOpen(false);
    setMode({ type: "new" });
    setDraft(createOfferDraft());
    setFeedback(null);
  }, [currentClinic?.id]);

  useEffect(() => {
    if (!editorOpen) {
      return;
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        setEditorOpen(false);
      }
    }

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [busy, editorOpen]);
  const currentCategoryName =
    categories.find((category) => category.id === draft.category_id)?.name || "Uncategorized";

  function openEditModal(row: OfferRow) {
    setMode({ type: "existing", id: row.id });
    setDraft(createOfferDraft(row));
    setEditorOpen(true);
    setFeedback(null);
  }

  function beginCreate() {
    setMode({ type: "new" });
    setDraft(createOfferDraft());
    setEditorOpen(true);
    setFeedback(null);
  }

  function closeEditor() {
    setEditorOpen(false);
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
        await createOffer({
          variables: buildCreateOfferVariables(currentClinic.id, draft),
        });
        await offersQuery.refetch();

        setEditorOpen(false);
        setMode({ type: "new" });
        setDraft(createOfferDraft());
        setFeedback({ tone: "success", message: "Offer created." });
        return;
      }

      await updateOffer({
        variables: buildUpdateOfferVariables(mode.id, draft),
      });
      await offersQuery.refetch();
      setEditorOpen(false);
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
      setEditorOpen(false);
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

  async function handleDeleteRow(row: OfferRow) {
    if (!window.confirm(`Delete "${row.name}"?`)) {
      return;
    }

    try {
      await deleteOffer({
        variables: buildDeleteOfferVariables(row.id),
      });
      await offersQuery.refetch();

      if (editorOpen && mode.type === "existing" && mode.id === row.id) {
        setEditorOpen(false);
        setMode({ type: "new" });
        setDraft(createOfferDraft());
      }

      setFeedback({ tone: "success", message: `Deleted "${row.name}".` });
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
          <div className="offer-admin__header-actions">
            <label className="field field--compact field--search">
              <span>Search</span>
              <input
                type="search"
                placeholder="Offer name, highlight, description"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <button type="button" className="button" onClick={beginCreate}>
              Create Offer
            </button>
          </div>
        }
      />

      <Panel
        className="offer-admin__list-panel offer-admin__list-panel--wide"
        title="Offers"
        subtitle={`${rows.length.toLocaleString("en-US")} offers in ${scopeLabel.toLowerCase()} view. ${createdSortLabel}.`}
      >
        <div className="offer-admin__filter-bar">
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
          <div className="offer-admin__filter-fields">
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
            <label className="field field--compact">
              <span>Sort order</span>
              <select value={sortOrderFilter} onChange={(event) => setSortOrderFilter(event.target.value)}>
                <option value="">All sort orders</option>
                {sortOrderOptions.map((option) => (
                  <option key={option} value={option}>
                    Sort {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="offer-admin__gallery-stats">
            <span>{allRows.length.toLocaleString("en-US")} loaded</span>
            <span>{selectedCountLabel}</span>
            <span>{statusSummary.active.toLocaleString("en-US")} active</span>
          </div>
        </div>

        {feedback && !editorOpen ? (
          <div className={`offer-admin__feedback offer-admin__feedback--${feedback.tone}`}>{feedback.message}</div>
        ) : null}

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
          <div className="offer-table-shell">
            <table className="offer-table">
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>Offer</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Sort Order</th>
                  <th>
                    <button
                      type="button"
                      className="offer-table__sort-button"
                      onClick={() =>
                        setCreatedSortDirection((previous) => (previous === "desc" ? "asc" : "desc"))
                      }
                    >
                      <span>Created Date</span>
                      <small>{createdSortDirection === "desc" ? "Desc" : "Asc"}</small>
                    </button>
                  </th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="offer-table__photo-frame">
                        {row.image ? <img src={row.image} alt={row.name} /> : <span>Offer</span>}
                      </div>
                    </td>
                    <td>
                      <div className="offer-table__offer">
                        <strong>{row.name}</strong>
                        <span>{excerptText(row.hight_light, 88)}</span>
                        <small>{excerptText(row.description, 110)}</small>
                      </div>
                    </td>
                    <td>{row.category?.name || "Uncategorized"}</td>
                    <td>
                      <span
                        className={`status-pill ${(row.status ?? "").toUpperCase() === "ACTIVE" ? "status-pill--active" : "status-pill--archived"}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="offer-table__number">{Number(row.sort_order ?? 0)}</td>
                    <td>{formatDate(row.created_at)}</td>
                    <td>
                      <div className="offer-table__actions">
                        <button type="button" className="button button--secondary" onClick={() => openEditModal(row)}>
                          Edit
                        </button>
                        <button type="button" className="button button--ghost" onClick={() => void handleDeleteRow(row)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Panel>

      {editorOpen ? (
        <div className="offer-editor-modal-shell" role="dialog" aria-modal="true" aria-labelledby="offer-editor-title">
          <button type="button" className="offer-editor-modal__backdrop" aria-label="Close editor" onClick={closeEditor} />
          <div className="offer-editor-modal">
            <div className="offer-editor-modal__header">
              <div className="offer-editor-modal__copy">
                <span className="offer-admin__eyebrow">{mode.type === "new" ? "Create offer" : "Edit offer"}</span>
                <h3 id="offer-editor-title">{mode.type === "new" ? "Create a new offer" : draft.name || "Edit offer"}</h3>
                <p>
                  {mode.type === "new"
                    ? "Add the image, highlight, and offer details here, then save to publish it into the list."
                    : "Update the selected offer in a focused editor without squeezing the main list page."}
                </p>
              </div>
              <div className="offer-editor-modal__header-actions">
                {mode.type === "existing" ? (
                  <button type="button" className="button button--ghost" disabled={busy} onClick={() => void handleDelete()}>
                    Delete
                  </button>
                ) : null}
                <button type="button" className="button button--secondary" disabled={busy} onClick={closeEditor}>
                  Close
                </button>
              </div>
            </div>

            {feedback ? (
              <div className={`offer-admin__feedback offer-admin__feedback--${feedback.tone}`}>{feedback.message}</div>
            ) : null}

            <div className="offer-editor-modal__layout">
              <div className="offer-editor">
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
                </div>
              </div>

              <aside className="offer-editor-modal__preview">
                <div className="offer-preview-card">
                  <div className="offer-preview-card__media">
                    {draft.image ? <img src={draft.image} alt={draft.name || "Offer preview"} /> : <span>Offer Preview</span>}
                  </div>
                  <div className="offer-preview-card__body">
                    <div className="offer-preview-card__meta">
                      <span
                        className={`status-pill ${draft.status === "ACTIVE" ? "status-pill--active" : "status-pill--archived"}`}
                      >
                        {draft.status}
                      </span>
                      <span>{currentCategoryName}</span>
                    </div>
                    <strong>{draft.name || "Untitled offer"}</strong>
                    <p>{excerptText(draft.hight_light || draft.description, 150)}</p>
                  </div>
                </div>

                <div className="offer-editor-modal__facts">
                  <div>
                    <span>Created</span>
                    <strong>{selectedRow ? formatDate(selectedRow.created_at) : "Will be set after save"}</strong>
                  </div>
                  <div>
                    <span>Sort order</span>
                    <strong>{Number(draft.sort_order ?? 0)}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <strong>{draft.status}</strong>
                  </div>
                  <div>
                    <span>Category</span>
                    <strong>{currentCategoryName}</strong>
                  </div>
                </div>
              </aside>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
