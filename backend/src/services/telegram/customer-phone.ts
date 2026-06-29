import { env } from "../../config/env.js";
import { maskPhone } from "../agent-hub/safety.js";
import type { TelegramChatType, TelegramTargetStatus } from "./types.js";

export type CustomerPhoneViewerContext = {
  chatType?: TelegramChatType;
  telegramUserId?: string | null;
  target?: Pick<TelegramTargetStatus, "isAgentChatEnabled" | "agentChatAccessMode" | "agentChatAllowedUserIds"> | null;
  canViewFullCustomerPhone?: boolean;
};

export type CustomerPhoneValue = {
  phone?: string | null;
  fullPhone?: string | null;
  maskedPhone?: string | null;
  customerPhone?: string | null;
  customerPhoneMasked?: string | null;
};

export type CustomerPhoneFormatOptions = {
  logContext?: string;
};

export function canViewFullCustomerPhone(viewerContext?: CustomerPhoneViewerContext) {
  if (typeof viewerContext?.canViewFullCustomerPhone === "boolean") {
    return viewerContext.canViewFullCustomerPhone;
  }

  if (!env.SHOW_FULL_CUSTOMER_PHONE) {
    return false;
  }

  if (viewerContext?.chatType !== "private" && env.MASK_PHONE_IN_GROUP_CHAT) {
    return false;
  }

  const target = viewerContext?.target;
  if (!target?.isAgentChatEnabled) {
    return false;
  }

  if (target.agentChatAccessMode === "all_members") {
    return Boolean(viewerContext?.telegramUserId);
  }

  return Boolean(
    viewerContext?.telegramUserId &&
      target.agentChatAllowedUserIds.includes(viewerContext.telegramUserId),
  );
}

export function formatCustomerPhone(
  customer: CustomerPhoneValue,
  viewerContext?: CustomerPhoneViewerContext,
  options?: CustomerPhoneFormatOptions,
) {
  const fullPhone = customer.fullPhone ?? customer.phone ?? customer.customerPhone ?? "";
  const maskedPhone = customer.maskedPhone ?? customer.customerPhoneMasked ?? maskPhone(fullPhone);

  if (canViewFullCustomerPhone(viewerContext) && fullPhone.trim()) {
    console.info("[telegram] displayed full customer phone", {
      context: options?.logContext ?? "customer_phone",
      chatType: viewerContext?.chatType,
      telegramUserId: viewerContext?.telegramUserId ?? null,
    });
    return fullPhone.trim();
  }

  return maskedPhone.trim() || "-";
}
