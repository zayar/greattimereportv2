import type { AiRevenueAction } from "../../types/ai-revenue-agent.js";

function cleanText(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function customerName(action: AiRevenueAction) {
  return cleanText(action.customer.customerName, "Customer");
}

function serviceName(action: AiRevenueAction) {
  return cleanText(action.service.serviceName, "your service");
}

function evidenceValue(action: AiRevenueAction, labels: string[]) {
  const lookup = labels.map((label) => label.toLowerCase());
  return action.evidence.find((item) => lookup.includes(item.label.toLowerCase()))?.value;
}

function packageOrServiceName(action: AiRevenueAction) {
  return cleanText(action.packageInfo.packageName) || cleanText(action.service.serviceName) || "your service package";
}

function remainingUnits(action: AiRevenueAction) {
  const value = Number(action.packageInfo.remainingUnits);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function durationParts(days: number) {
  const safeDays = Math.max(0, Math.round(days));
  if (safeDays >= 365) {
    const years = Math.floor(safeDays / 365);
    const remainingDays = safeDays % 365;
    const months = Math.floor(remainingDays / 30);
    const daysLeft = remainingDays % 30;
    return [
      { value: years, myanmarUnit: "နှစ်" },
      ...(months > 0 ? [{ value: months, myanmarUnit: "လ" }] : []),
      ...(months === 0 && daysLeft > 0 ? [{ value: daysLeft, myanmarUnit: "ရက်" }] : []),
    ];
  }

  if (safeDays >= 60) {
    const months = Math.floor(safeDays / 30);
    const daysLeft = safeDays % 30;
    return [
      { value: months, myanmarUnit: "လ" },
      ...(daysLeft > 0 ? [{ value: daysLeft, myanmarUnit: "ရက်" }] : []),
    ];
  }

  return [{ value: safeDays, myanmarUnit: "ရက်" }];
}

function formatDurationMyanmar(days: number | null | undefined) {
  if (days == null) {
    return "";
  }

  return durationParts(days)
    .map((part) => `${part.value.toLocaleString("en-US")} ${part.myanmarUnit}`)
    .join(" ");
}

function appointmentDateTime(action: AiRevenueAction) {
  return cleanText(action.appointment.appointmentDateTime, "your scheduled appointment time");
}

function lastVisitDate(action: AiRevenueAction) {
  return cleanText(
    action.service.lastVisitDate ??
      action.packageInfo.lastUsedAt ??
      evidenceValue(action, ["Last visit date", "Last usage date"]),
  );
}

function daysSinceLastVisit(action: AiRevenueAction) {
  const directValue = Number(evidenceValue(action, ["Days since last visit", "Days since activity"]));
  if (Number.isFinite(directValue) && directValue > 0) {
    return Math.round(directValue);
  }

  const dateText = lastVisitDate(action);
  if (!dateText) {
    return null;
  }

  const date = new Date(`${dateText.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return Math.max(0, Math.round((Date.now() - date.getTime()) / 86_400_000));
}

function contextSentence(action: AiRevenueAction) {
  const parts: string[] = [];
  const service = serviceName(action);
  const remaining = remainingUnits(action);
  const days = daysSinceLastVisit(action);

  if (service) {
    parts.push(`နောက်ဆုံးပြုလုပ်ခဲ့သော ဝန်ဆောင်မှုမှာ ${service} ဖြစ်ပါတယ်`);
  }
  if (remaining > 0) {
    parts.push(`${packageOrServiceName(action)} အတွက် session ${remaining} ကြိမ် ကျန်ရှိနေပါတယ်`);
  }
  if (days != null && days > 0) {
    parts.push(`နောက်ဆုံးလာရောက်ပြီး ${formatDurationMyanmar(days)} ခန့်ရှိပါပြီ`);
  }

  return parts.length ? `${parts.join("၊ ")}။ ` : "";
}

function greeting(action: AiRevenueAction) {
  return `မင်္ဂလာပါ ${customerName(action)} ရှင့်/ခင်ဗျာ။ `;
}

export function buildAiRevenueMessageDraft(action: AiRevenueAction) {
  const context = contextSentence(action);
  const service = serviceName(action);
  const packageName = packageOrServiceName(action);
  const remaining = remainingUnits(action);

  switch (action.actionType) {
    case "service_reminder_overdue":
      return `${greeting(action)}${context}${service} follow-up အချိန်ကျော်နေပြီမို့ ဒီအပတ်အတွင်း အဆင်ပြေတဲ့အချိန်ကို ချိန်းပေးရမလား။`;

    case "service_reminder_follow_up":
      return `${greeting(action)}${context}${service} follow-up အချိန်ရောက်နေပါပြီ။ အဆင်ပြေတဲ့ appointment အချိန်ကို ချိန်းပေးရမလား။`;

    case "unused_package_follow_up":
      return `${greeting(action)}${context}${packageName} အတွက် session ${remaining} ကြိမ် ကျန်ရှိနေသေးပါတယ်။ နောက်တစ်ကြိမ် လာရောက်အသုံးပြုဖို့ အဆင်ပြေတဲ့အချိန်ကို ချိန်းပေးရမလား။`;

    case "appointment_confirmation_reminder":
      return `${greeting(action)}${appointmentDateTime(action)} တွင် appointment ရှိပါတယ်။ လာရောက်မည်ဆို confirm ပြန်ပေးပါ၊ အချိန်ပြောင်းရန် သို့မဟုတ် cancel လုပ်ရန်လည်း ပြန်ပြောနိုင်ပါတယ်။`;

    case "no_show_recovery":
      return `${greeting(action)}ယခင် appointment တွင် မလာရောက်ဖြစ်ခဲ့တာ တွေ့ရပါတယ်။ အဆင်ပြေတဲ့အချိန်အသစ် ပြန်ချိန်းပေးရမလား။`;

    case "cancelled_appointment_recovery":
      return `${greeting(action)}${service} appointment ကို cancel ဖြစ်ထားတာ တွေ့ရပါတယ်။ အဆင်ပြေတဲ့နေ့/အချိန်အသစ် ပြန်ချိန်းပေးရမလား။`;

    default:
      return `${greeting(action)}${context}အဆင်ပြေတဲ့ appointment အချိန်ကို ချိန်းပေးရမလား။`;
  }
}
