import { useRef, useState, type ChangeEvent } from "react";
import { getDownloadURL, ref, uploadBytesResumable } from "firebase/storage";
import { storage } from "../../lib/firebase";

type Props = {
  clinicId: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
};

function sanitizeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-");
}

export function OfferArtworkField({ clinicId, label, hint, value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setUploading(true);
    setProgress(0);
    setError(null);

    try {
      const storageRef = ref(
        storage,
        `adminUploads/${clinicId}/offers/${Date.now()}-${sanitizeFileName(file.name)}`,
      );

      const uploadTask = uploadBytesResumable(storageRef, file, {
        contentType: file.type,
      });

      const downloadUrl = await new Promise<string>((resolve, reject) => {
        uploadTask.on(
          "state_changed",
          (snapshot) => {
            const nextProgress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
            setProgress(nextProgress);
          },
          (uploadError) => reject(uploadError),
          () => {
            getDownloadURL(uploadTask.snapshot.ref).then(resolve).catch(reject);
          },
        );
      });

      onChange(downloadUrl);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Image upload failed.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  return (
    <div className="offer-artwork-field">
      <div className="offer-artwork-field__copy">
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>

      <button
        type="button"
        className={`offer-artwork-field__surface ${value ? "offer-artwork-field__surface--filled" : ""}`.trim()}
        onClick={() => inputRef.current?.click()}
      >
        {value ? <img src={value} alt={label} className="offer-artwork-field__image" /> : null}
        <div className="offer-artwork-field__overlay">
          <strong>{value ? "Replace artwork" : "Upload artwork"}</strong>
          <span>{value ? "Click to swap the current image." : "Use a clear portrait or square cover image."}</span>
          {uploading ? <small>Uploading... {progress}%</small> : null}
          {!uploading && value ? <small>Click to replace</small> : null}
        </div>
      </button>

      <div className="offer-artwork-field__actions">
        <button type="button" className="button button--secondary" onClick={() => inputRef.current?.click()} disabled={uploading}>
          {uploading ? "Uploading..." : value ? "Replace Image" : "Upload Image"}
        </button>
        <button type="button" className="button button--ghost" onClick={() => onChange("")} disabled={uploading || !value}>
          Remove
        </button>
      </div>

      {error ? <div className="offer-admin__feedback offer-admin__feedback--error">{error}</div> : null}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="offer-artwork-field__input"
        onChange={handleFileChange}
      />
    </div>
  );
}
