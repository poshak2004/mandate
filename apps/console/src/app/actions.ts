"use server";

import { MandateApiError } from "@mandate/sdk";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { api } from "@/lib/api";

const str = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
};

function message(err: unknown): string {
  if (err instanceof MandateApiError) return err.message;
  return err instanceof Error ? err.message : String(err);
}

/** Approve or reject an escalated decision; writes an approval receipt. */
export async function resolveEscalation(form: FormData) {
  const receiptId = str(form, "receipt_id");
  const resolution = str(form, "resolution") === "approve" ? "approve" : "reject";
  const resolvedBy = str(form, "resolved_by");
  const note = str(form, "note") || undefined;
  let target = `/escalations?done=${resolution}`;
  try {
    if (!resolvedBy) throw new Error("Enter who is approving or rejecting.");
    await api().escalations.resolve(receiptId, resolution, resolvedBy, note);
  } catch (err) {
    target = `/escalations?error=${encodeURIComponent(message(err))}`;
  }
  revalidatePath("/");
  revalidatePath("/escalations");
  redirect(target);
}

/** Upload policy YAML as a new draft version (nothing changes until it is published). */
export async function uploadPolicy(form: FormData) {
  const yaml = str(form, "yaml");
  let target: string;
  try {
    const draft = await api().policies.upload(yaml);
    target = `/policies/${draft.version}`;
  } catch (err) {
    target = `/policies?error=${encodeURIComponent(message(err))}`;
  }
  revalidatePath("/policies");
  redirect(target);
}

/** Publish a draft: from now on /v1/decide uses it. */
export async function publishPolicy(form: FormData) {
  const version = Number(str(form, "version"));
  let target = `/policies/${version}?published=1`;
  try {
    await api().policies.publish(version);
  } catch (err) {
    target = `/policies/${version}?error=${encodeURIComponent(message(err))}`;
  }
  revalidatePath("/policies");
  revalidatePath("/");
  redirect(target);
}

/** Revoke a mandate (adds a revoked version; earlier versions are kept). */
export async function revokeMandate(form: FormData) {
  const id = str(form, "id");
  let target = `/mandates/${encodeURIComponent(id)}?revoked=1`;
  try {
    await api().mandates.revoke(id);
  } catch (err) {
    target = `/mandates/${encodeURIComponent(id)}?error=${encodeURIComponent(message(err))}`;
  }
  revalidatePath("/mandates");
  redirect(target);
}
