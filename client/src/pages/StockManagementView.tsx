/**
 * StockManagementView — admin-only page for managing food items.
 *
 * Lists all food items. The admin can add a new item, edit an existing item in
 * a popup, mark items as out of stock (set quantity to 0), restore stock, and
 * adjust price. Only accessible to the admin user (mobile 9512311001).
 */

import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import {
  getAdminItems,
  updateItemStock,
  createItem,
  updateItem,
  deleteItem,
  type CreateItemRequest,
  type UpdateItemRequest,
} from "../api/client.js";
import type { FoodItem } from "../../../types/index.js";
import { useCustomer } from "../customer/CustomerContext.js";
import { usePolling } from "../hooks/usePolling.js";
import { ADMIN_MOBILE } from "../constants.js";
import { ROUTES } from "../routes.js";
import { formatINR } from "../format.js";

export function StockManagementView(): JSX.Element {
  const { customer } = useCustomer();

  if (!customer || customer.mobile !== ADMIN_MOBILE) {
    return (
      <main className="admin">
        <h1>Access Denied</h1>
        <p>You do not have permission to view this page.</p>
        <Link to={ROUTES.home}>Go to Home</Link>
      </main>
    );
  }

  return <StockPanel />;
}

function StockPanel(): JSX.Element {
  const fetchItems = useCallback(() => getAdminItems(), []);
  const { data: items, error, loading, refresh } = usePolling<FoodItem[]>(fetchItems);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<FoodItem | null>(null);

  async function handleMarkOutOfStock(itemId: string): Promise<void> {
    setUpdatingId(itemId);
    try {
      await updateItemStock(itemId, 0);
      refresh();
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleRestoreStock(itemId: string, quantity: number): Promise<void> {
    setUpdatingId(itemId);
    try {
      await updateItemStock(itemId, quantity);
      refresh();
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleDelete(item: FoodItem): Promise<void> {
    const confirmed = window.confirm(
      `Delete “${item.name}”? This removes it from the marketplace and can’t be undone.`
    );
    if (!confirmed) return;
    setUpdatingId(item.id);
    try {
      await deleteItem(item.id);
      refresh();
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <main className="admin">
      <header className="admin-header">
        <h1>Stock Management</h1>
        <p className="admin-note">
          Add a new item, edit an item, or mark items as out of stock and restore their availability.
        </p>
      </header>

      <AddItemForm onCreated={refresh} />

      {error && !items && (
        <p role="alert" className="admin-error">
          Couldn&apos;t load items. Retrying…
        </p>
      )}

      {loading && !items && !error && <p role="status">Loading items…</p>}

      {items && items.length === 0 && <p>No items found.</p>}

      {items && items.length > 0 && (
        <div className="stock-grid" data-testid="stock-grid">
          {items.map((item) => {
            const isOutOfStock = item.availableQuantity === 0;
            const busy = updatingId === item.id;
            return (
              <StockCard
                key={item.id}
                item={item}
                isOutOfStock={isOutOfStock}
                busy={busy}
                onMarkOutOfStock={handleMarkOutOfStock}
                onRestoreStock={handleRestoreStock}
                onEdit={() => setEditingItem(item)}
                onDelete={() => handleDelete(item)}
              />
            );
          })}
        </div>
      )}

      {editingItem && (
        <EditItemModal
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={() => {
            setEditingItem(null);
            refresh();
          }}
        />
      )}
    </main>
  );
}

interface AddItemFormProps {
  /** Called after a new item is successfully created, to refresh the list. */
  onCreated: () => void;
}

/**
 * Collapsible "Add New Item" form. Validates the required fields client-side
 * and POSTs a new item. On success it resets the form and asks the parent to
 * refresh the item list.
 */
function AddItemForm({ onCreated }: AddItemFormProps): JSX.Element {
  const [open, setOpen] = useState(false);

  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [quantity, setQuantity] = useState("50");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const priceValue = Number(price);
  const qtyValue = Number(quantity);
  const nameValid = name.trim() !== "";
  const priceValid = price.trim() !== "" && Number.isFinite(priceValue) && priceValue > 0;
  const qtyValid = quantity.trim() === "" || (Number.isFinite(qtyValue) && qtyValue >= 0);
  const formValid = nameValid && priceValid && qtyValid;

  function resetForm(): void {
    setName("");
    setPrice("");
    setQuantity("50");
    setDescription("");
    setImageUrl("");
  }

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!formValid || submitting) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      const req: CreateItemRequest = {
        name: name.trim(),
        price: priceValue,
        availableQuantity: quantity.trim() === "" ? 0 : Math.floor(qtyValue),
        description: description.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
      };
      const created = await createItem(req);
      setSuccess(`Added “${created.name}”.`);
      resetForm();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add item.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <div className="stock-add">
        <button
          type="button"
          className="stock-card-btn stock-card-btn--restore"
          data-testid="stock-add-open"
          onClick={() => {
            setOpen(true);
            setSuccess(null);
          }}
        >
          + Add New Item
        </button>
        {success && (
          <span role="status" className="stock-add-success">
            {success}
          </span>
        )}
      </div>
    );
  }

  return (
    <form className="stock-add-form" onSubmit={handleSubmit} data-testid="stock-add-form">
      <h2 className="stock-add-title">Add New Item</h2>

      <ItemFields
        idPrefix="stock-add"
        name={name}
        setName={setName}
        price={price}
        setPrice={setPrice}
        quantity={quantity}
        setQuantity={setQuantity}
        quantityLabel="Initial stock"
        description={description}
        setDescription={setDescription}
        imageUrl={imageUrl}
        setImageUrl={setImageUrl}
      />

      {error && (
        <p role="alert" className="admin-error">
          {error}
        </p>
      )}

      <div className="stock-add-actions">
        <button
          type="submit"
          className="stock-card-btn stock-card-btn--restore"
          data-testid="stock-add-submit"
          disabled={!formValid || submitting}
        >
          {submitting ? "Adding…" : "Add Item"}
        </button>
        <button
          type="button"
          className="stock-card-btn stock-card-btn--out"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface EditItemModalProps {
  item: FoodItem;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * "Edit Item" popup dialog. Pre-filled with the item's current values; on save
 * it PATCHes the fields and asks the parent to refresh. Rendered as a modal
 * overlay; clicking the backdrop or pressing Cancel closes it.
 */
function EditItemModal({ item, onClose, onSaved }: EditItemModalProps): JSX.Element {
  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(String(item.price));
  const [quantity, setQuantity] = useState(String(item.availableQuantity));
  const [description, setDescription] = useState(item.description);
  const [imageUrl, setImageUrl] = useState(item.imageUrl);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceValue = Number(price);
  const qtyValue = Number(quantity);
  const nameValid = name.trim() !== "";
  const priceValid = price.trim() !== "" && Number.isFinite(priceValue) && priceValue > 0;
  const qtyValid = quantity.trim() !== "" && Number.isFinite(qtyValue) && qtyValue >= 0;
  const formValid = nameValid && priceValid && qtyValid;

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (!formValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const patch: UpdateItemRequest = {
        name: name.trim(),
        price: priceValue,
        availableQuantity: Math.floor(qtyValue),
        description,
        imageUrl,
      };
      await updateItem(item.id, patch);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update item.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${item.name}`}
        data-testid={`stock-edit-modal-${item.id}`}
      >
        <div className="modal-header">
          <h2 className="stock-add-title">Edit Item</h2>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={onClose}
            disabled={submitting}
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} data-testid={`stock-edit-form-${item.id}`}>
          <ItemFields
            idPrefix={`stock-edit-${item.id}`}
            name={name}
            setName={setName}
            price={price}
            setPrice={setPrice}
            quantity={quantity}
            setQuantity={setQuantity}
            quantityLabel="Stock"
            description={description}
            setDescription={setDescription}
            imageUrl={imageUrl}
            setImageUrl={setImageUrl}
          />

          {error && (
            <p role="alert" className="admin-error">
              {error}
            </p>
          )}

          <div className="stock-add-actions">
            <button
              type="submit"
              className="stock-card-btn stock-card-btn--price"
              data-testid={`stock-edit-save-${item.id}`}
              disabled={!formValid || submitting}
            >
              {submitting ? "Saving…" : "Save Changes"}
            </button>
            <button
              type="button"
              className="stock-card-btn stock-card-btn--out"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface ItemFieldsProps {
  idPrefix: string;
  name: string;
  setName: (v: string) => void;
  price: string;
  setPrice: (v: string) => void;
  quantity: string;
  setQuantity: (v: string) => void;
  quantityLabel: string;
  description: string;
  setDescription: (v: string) => void;
  imageUrl: string;
  setImageUrl: (v: string) => void;
}

/** Shared field grid used by both the add and edit item forms. */
function ItemFields(props: ItemFieldsProps): JSX.Element {
  const {
    idPrefix,
    name,
    setName,
    price,
    setPrice,
    quantity,
    setQuantity,
    quantityLabel,
    description,
    setDescription,
    imageUrl,
    setImageUrl,
  } = props;

  return (
    <div className="stock-add-grid">
      <label className="stock-add-field">
        <span>Name *</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="stock-card-input"
          data-testid={`${idPrefix}-name`}
          required
        />
      </label>

      <label className="stock-add-field">
        <span>Price (₹) *</span>
        <input
          type="number"
          min="1"
          step="any"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="stock-card-input"
          data-testid={`${idPrefix}-price`}
          required
        />
      </label>

      <label className="stock-add-field">
        <span>{quantityLabel}</span>
        <input
          type="number"
          min="0"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          className="stock-card-input"
          data-testid={`${idPrefix}-quantity`}
        />
      </label>

      <label className="stock-add-field stock-add-field--wide">
        <span>Image URL</span>
        <input
          type="url"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          className="stock-card-input"
          placeholder="https://…"
        />
      </label>

      <label className="stock-add-field stock-add-field--wide">
        <span>Description</span>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="stock-card-input"
        />
      </label>
    </div>
  );
}

interface StockCardProps {
  item: FoodItem;
  isOutOfStock: boolean;
  busy: boolean;
  onMarkOutOfStock: (itemId: string) => void;
  onRestoreStock: (itemId: string, quantity: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}

function StockCard({
  item,
  isOutOfStock,
  busy,
  onMarkOutOfStock,
  onRestoreStock,
  onEdit,
  onDelete,
}: StockCardProps): JSX.Element {
  const [restoreQty, setRestoreQty] = useState("50");

  return (
    <article
      className={`stock-card${isOutOfStock ? " stock-card--out" : ""}`}
      data-testid={`stock-card-${item.id}`}
    >
      <div className="stock-card-header">
        <h3 className="stock-card-name">{item.name}</h3>
        <div className="stock-card-header-actions">
          <button
            type="button"
            className="stock-card-edit-toggle"
            data-testid={`stock-edit-toggle-${item.id}`}
            onClick={onEdit}
          >
            Edit
          </button>
          <button
            type="button"
            className="stock-card-delete-toggle"
            data-testid={`stock-delete-${item.id}`}
            onClick={onDelete}
            disabled={busy}
          >
            {busy ? "…" : "Delete"}
          </button>
        </div>
      </div>

      <div className="stock-card-info">
        <span className="stock-card-price">{formatINR(item.price)}</span>
        <span
          className={`stock-card-qty ${isOutOfStock ? "stock-card-qty--zero" : ""}`}
          data-testid={`stock-qty-${item.id}`}
        >
          {isOutOfStock ? "OUT OF STOCK" : `${item.availableQuantity} in stock`}
        </span>
      </div>

      <div className="stock-card-actions">
        {isOutOfStock ? (
          <div className="stock-card-restore">
            <input
              type="number"
              min="1"
              value={restoreQty}
              onChange={(e) => setRestoreQty(e.target.value)}
              className="stock-card-input"
              aria-label={`Restore quantity for ${item.name}`}
            />
            <button
              type="button"
              className="stock-card-btn stock-card-btn--restore"
              disabled={busy || !restoreQty || Number(restoreQty) < 1}
              onClick={() => onRestoreStock(item.id, Number(restoreQty))}
            >
              {busy ? "Updating…" : "Restore Stock"}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="stock-card-btn stock-card-btn--out"
            disabled={busy}
            onClick={() => onMarkOutOfStock(item.id)}
          >
            {busy ? "Updating…" : "Mark Out of Stock"}
          </button>
        )}
      </div>
    </article>
  );
}

export default StockManagementView;
