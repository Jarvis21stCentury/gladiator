import { permanentRedirect } from "next/navigation";

/** A sitting moved to `/study/[courseId]` with the rest of studying. */
export default async function ReviewSessionRedirect({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const { courseId } = await params;
  permanentRedirect(`/study/${courseId}`);
}
