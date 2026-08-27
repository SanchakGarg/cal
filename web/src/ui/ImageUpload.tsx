import { useRef, useState } from "react";
import { Avatar } from "./Layout.tsx";
import { Button } from "./Button.tsx";
import { api, errorMessage } from "../lib/api.ts";
import { useToast } from "./Toast.tsx";
import "./ImageUpload.css";

/** Kept in step with the formats the server sniffs for. */
const ACCEPT = "image/png,image/jpeg,image/gif,image/webp";
const MAX_BYTES = 2 * 1024 * 1024;
/** Longest edge kept. Nothing in the app renders an avatar larger than this. */
const MAX_EDGE = 512;

/**
 * Crops to a centred square and scales down before upload, so a 6MB phone photo
 * becomes a few tens of KB and comfortably fits the size cap. Animated GIFs are
 * left alone — drawing one to a canvas would keep only the first frame.
 */
async function prepare(file: File): Promise<string> {
  const readAsDataUrl = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("That file could not be read"));
      reader.readAsDataURL(file);
    });

  if (file.type === "image/gif") return readAsDataUrl();

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    // Older browsers, or a format the decoder will not take: send it as-is and
    // let the server have the last word on whether it is an image.
    return readAsDataUrl();
  }

  const edge = Math.min(bitmap.width, bitmap.height);
  const size = Math.min(edge, MAX_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    return readAsDataUrl();
  }
  context.drawImage(
    bitmap,
    (bitmap.width - edge) / 2,
    (bitmap.height - edge) / 2,
    edge,
    edge,
    0,
    0,
    size,
    size
  );
  bitmap.close();
  // PNG keeps transparency, which logos rely on; the downscale above is what
  // keeps the file small.
  return canvas.toDataURL("image/png");
}

interface ImageUploadProps {
  /** Current image, or null for the initials fallback. */
  value: string | null;
  onChange: (url: string | null) => void;
  /** Drives the initials and tint of the empty state. */
  name: string;
  colorKey?: string;
  label?: string;
  hint?: string;
}

/**
 * Picks an image, uploads it, and hands back the stored URL. The preview is the
 * same Avatar the rest of the app renders, so what you see here is what a booker
 * sees — including the initials fallback when there is no picture.
 */
export function ImageUpload({
  value,
  onChange,
  name,
  colorKey,
  label = "Picture",
  hint,
}: ImageUploadProps) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      // The cap applies to what is actually sent, not to what was picked: a 6MB
      // phone photo is fine because `prepare` shrinks it first. Only a file that
      // is still too big after that — an animated GIF, say — is refused.
      const dataUrl = await prepare(file);
      const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(",") - 1) * 0.75);
      if (bytes > MAX_BYTES) {
        toast.error("That picture is too large. Try one under 2MB.");
        return;
      }
      const { url } = await api.post<{ url: string }>("/v2/uploads/image", { dataUrl });
      onChange(url);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
      // Allow re-picking the same file after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="cal-imgup">
      <Avatar name={name} src={value} size={72} colorKey={colorKey} />
      <div className="cal-imgup__body">
        <p className="cal-imgup__label">{label}</p>
        {hint ? <p className="cal-field__hint">{hint}</p> : null}
        <div className="cal-row cal-imgup__actions">
          <Button
            variant="secondary"
            size="sm"
            loading={busy}
            onClick={() => inputRef.current?.click()}
          >
            {value ? "Replace" : "Upload"}
          </Button>
          {value ? (
            <Button variant="minimal" size="sm" onClick={() => onChange(null)}>
              Remove
            </Button>
          ) : null}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="cal-imgup__input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void pick(file);
          }}
        />
      </div>
    </div>
  );
}
