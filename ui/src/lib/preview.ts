/** `VITE_PREVIEW=1 npm run build`: a frontend-only hosted preview. Never calls /ui/*, recorded/synthetic data only. */
export const PREVIEW = import.meta.env?.VITE_PREVIEW === "1";
