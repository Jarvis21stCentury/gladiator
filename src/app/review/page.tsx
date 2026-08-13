import { permanentRedirect } from "next/navigation";

/** Review is now the top of `/study` — see the note in `app/digest/page.tsx`. */
export default function ReviewRedirect() {
  permanentRedirect("/study#due");
}
