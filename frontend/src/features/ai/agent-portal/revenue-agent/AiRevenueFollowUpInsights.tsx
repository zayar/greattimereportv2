import type { AiRevenueAction } from "../../../../types/domain";

type ScoreBand = "high" | "medium" | "low";

type InsightRow = {
  label: string;
  value: string;
  helper?: string;
};

type TimelineItem = {
  label: string;
  value: string;
  helper?: string;
};

type ServiceBalance = {
  key: string;
  serviceName: string;
  packageName: string;
  remaining: number | null;
  purchased: number | null;
  used: number | null;
  lastUsedAt: string;
  source: "focused" | "related" | "evidence";
};

type TreatmentBalanceRow = ServiceBalance & {
  isFocused: boolean;
  note: string;
};

function text(value: string | number | null | undefined) {
  if (value == null) {
    return "";
  }
  return String(value).trim();
}

function numberValue(value: number | string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function nullableNumber(value: number | string | null | undefined) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function formatNumber(value: number | null | undefined) {
  return Math.round(value ?? 0).toLocaleString("en-US");
}

function durationParts(days: number) {
  const safeDays = Math.max(0, Math.round(days));
  if (safeDays >= 365) {
    const years = Math.floor(safeDays / 365);
    const remainingDays = safeDays % 365;
    const months = Math.floor(remainingDays / 30);
    const daysLeft = remainingDays % 30;
    return [
      { value: years, unit: "year", myanmarUnit: "နှစ်" },
      ...(months > 0 ? [{ value: months, unit: "month", myanmarUnit: "လ" }] : []),
      ...(months === 0 && daysLeft > 0 ? [{ value: daysLeft, unit: "day", myanmarUnit: "ရက်" }] : []),
    ];
  }

  if (safeDays >= 60) {
    const months = Math.floor(safeDays / 30);
    const daysLeft = safeDays % 30;
    return [
      { value: months, unit: "month", myanmarUnit: "လ" },
      ...(daysLeft > 0 ? [{ value: daysLeft, unit: "day", myanmarUnit: "ရက်" }] : []),
    ];
  }

  return [{ value: safeDays, unit: "day", myanmarUnit: "ရက်" }];
}

function formatDuration(days: number | null | undefined) {
  if (days == null) {
    return "";
  }

  return durationParts(days)
    .map((part) => `${formatNumber(part.value)} ${part.unit}${part.value === 1 ? "" : "s"}`)
    .join(" ");
}

function formatDurationAgo(days: number | null | undefined) {
  const duration = formatDuration(days);
  return duration ? `${duration} ago` : "";
}

function formatDurationSince(days: number | null | undefined) {
  const duration = formatDuration(days);
  return duration ? `${duration} since last usage` : "";
}

function formatDurationMyanmar(days: number | null | undefined) {
  if (days == null) {
    return "";
  }

  return durationParts(days)
    .map((part) => `${formatNumber(part.value)} ${part.myanmarUnit}`)
    .join(" ");
}

function formatMoney(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return amount > 0 ? `${Math.round(amount).toLocaleString("en-US")} MMK` : "Not available";
}

function titleCase(value: string | null | undefined) {
  return text(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeText(value: string | number | null | undefined) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function normalizePhone(value: string | null | undefined) {
  return text(value).replace(/\D/g, "");
}

function findEvidence(action: AiRevenueAction, labels: string[]) {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  return action.evidence.find((item) => normalizedLabels.includes(item.label.toLowerCase()))?.value;
}

function evidenceNumber(action: AiRevenueAction, labels: string[]) {
  return nullableNumber(findEvidence(action, labels));
}

function serviceMatches(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  return Boolean(normalizedLeft && normalizedRight && (normalizedLeft === normalizedRight || normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)));
}

export function isSameCustomerAction(left: AiRevenueAction, right: AiRevenueAction) {
  const leftPhone = normalizePhone(left.customer.phoneNumber || left.customer.phoneMasked);
  const rightPhone = normalizePhone(right.customer.phoneNumber || right.customer.phoneMasked);
  return Boolean(
    (left.customer.customerKey && right.customer.customerKey && left.customer.customerKey === right.customer.customerKey) ||
      (left.customer.memberId && right.customer.memberId && left.customer.memberId === right.customer.memberId) ||
      (leftPhone && rightPhone && leftPhone === rightPhone) ||
      (left.customer.customerName &&
        right.customer.customerName &&
        normalizeText(left.customer.customerName) === normalizeText(right.customer.customerName)),
  );
}

function focusedServiceName(action: AiRevenueAction) {
  return (
    text(findEvidence(action, ["Focused treatment"])) ||
    text(action.service.serviceName) ||
    text(findEvidence(action, ["Last service", "Service", "Service(s)"]))
  );
}

function daysSinceLastVisit(action: AiRevenueAction) {
  const directValue =
    findEvidence(action, ["Days since last visit", "Days since activity", "Days since last usage"]) ??
    null;
  const numeric = Number(directValue);
  if (Number.isFinite(numeric) && numeric > 0) {
    return Math.round(numeric);
  }

  const lastDate = action.service.lastVisitDate ?? action.packageInfo.lastUsedAt;
  if (!lastDate) {
    return null;
  }

  const parsed = new Date(`${lastDate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  const today = new Date();
  return Math.max(0, Math.round((today.getTime() - parsed.getTime()) / 86_400_000));
}

function purchasedUnits(action: AiRevenueAction) {
  return (
    numberValue(action.packageInfo.purchasedUnits) ||
    numberValue(findEvidence(action, ["Purchased sessions", "Focused treatment purchased"]))
  );
}

function usedUnits(action: AiRevenueAction) {
  return numberValue(action.packageInfo.usedUnits) || numberValue(findEvidence(action, ["Used sessions", "Focused treatment used"]));
}

function remainingUnits(action: AiRevenueAction) {
  return (
    numberValue(action.packageInfo.remainingUnits) ||
    numberValue(findEvidence(action, ["Remaining sessions", "Remaining package sessions", "Focused treatment remaining"]))
  );
}

function purchaseDate(action: AiRevenueAction) {
  return text(findEvidence(action, ["Purchase date", "Package purchase date", "Purchased date"]));
}

function lastUsageDate(action: AiRevenueAction) {
  return text(
    action.packageInfo.lastUsedAt ??
      action.service.lastVisitDate ??
      findEvidence(action, ["Focused treatment last usage", "Last usage date", "Last visit date"]),
  );
}

function totalSpend(action: AiRevenueAction) {
  const lifetimeSpend = findEvidence(action, ["Lifetime spend", "Total spending", "Total spend"]);
  const averageSpend = findEvidence(action, ["Average spend"]);
  return text(lifetimeSpend || averageSpend);
}

function actionServiceBalance(action: AiRevenueAction, source: ServiceBalance["source"]): ServiceBalance | null {
  const serviceName = text(action.service.serviceName) || text(findEvidence(action, ["Service(s)", "Last service", "Service"]));
  const packageName = text(action.packageInfo.packageName || findEvidence(action, ["Package"]));
  const remaining = nullableNumber(
    action.packageInfo.remainingUnits ??
      findEvidence(action, ["Focused treatment remaining", "Remaining sessions", "Remaining package sessions"]),
  );
  const purchased = nullableNumber(
    action.packageInfo.purchasedUnits ?? findEvidence(action, ["Focused treatment purchased", "Purchased sessions"]),
  );
  const used = nullableNumber(action.packageInfo.usedUnits ?? findEvidence(action, ["Focused treatment used", "Used sessions"]));

  if (!serviceName && !packageName && remaining == null && purchased == null) {
    return null;
  }

  const label = serviceName || packageName || "Package balance";
  return {
    key: `${normalizeText(label)}:${normalizeText(packageName)}`,
    serviceName: label,
    packageName,
    remaining,
    purchased,
    used,
    lastUsedAt: text(
      action.packageInfo.lastUsedAt ??
        action.service.lastVisitDate ??
        findEvidence(action, ["Focused treatment last usage", "Last usage date", "Last visit date"]),
    ),
    source,
  };
}

function parseOtherBalanceEvidence(action: AiRevenueAction): ServiceBalance[] {
  const raw = text(findEvidence(action, ["Other remaining services", "Remaining services", "Other service balances"]));
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const serviceFirst = part.match(/^(.+):\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
      if (serviceFirst) {
        const serviceName = serviceFirst[1].trim();
        return {
          key: `${normalizeText(serviceName)}:evidence`,
          serviceName,
          packageName: "",
          remaining: numberValue(serviceFirst[2]),
          purchased: numberValue(serviceFirst[3]),
          used: numberValue(serviceFirst[3]) - numberValue(serviceFirst[2]),
          lastUsedAt: "",
          source: "evidence" as const,
        };
      }

      const withPurchased = part.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s+(.+)$/);
      if (withPurchased) {
        const serviceName = withPurchased[3].trim();
        return {
          key: `${normalizeText(serviceName)}:evidence`,
          serviceName,
          packageName: "",
          remaining: numberValue(withPurchased[1]),
          purchased: numberValue(withPurchased[2]),
          used: numberValue(withPurchased[2]) - numberValue(withPurchased[1]),
          lastUsedAt: "",
          source: "evidence" as const,
        };
      }

      const remainingOnly = part.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
      if (remainingOnly) {
        const serviceName = remainingOnly[2].trim();
        return {
          key: `${normalizeText(serviceName)}:evidence`,
          serviceName,
          packageName: "",
          remaining: numberValue(remainingOnly[1]),
          purchased: null,
          used: null,
          lastUsedAt: "",
          source: "evidence" as const,
        };
      }

      return {
        key: `${normalizeText(part)}:evidence`,
        serviceName: part,
        packageName: "",
        remaining: null,
        purchased: null,
        used: null,
        lastUsedAt: "",
        source: "evidence" as const,
      };
    });
}

export function collectServiceBalances(action: AiRevenueAction, relatedActions: AiRevenueAction[] = []) {
  const balances = new Map<string, ServiceBalance>();
  const addBalance = (balance: ServiceBalance | null) => {
    if (!balance) {
      return;
    }
    const current = balances.get(balance.key);
    if (!current || (balance.remaining ?? -1) > (current.remaining ?? -1)) {
      balances.set(balance.key, balance);
    }
  };

  addBalance(actionServiceBalance(action, "focused"));
  parseOtherBalanceEvidence(action).forEach(addBalance);
  relatedActions
    .filter((item) => item.id !== action.id && isSameCustomerAction(item, action))
    .map((item) => actionServiceBalance(item, "related"))
    .forEach(addBalance);

  return [...balances.values()].sort((left, right) => {
    const leftRemaining = left.remaining ?? -1;
    const rightRemaining = right.remaining ?? -1;
    return rightRemaining - leftRemaining || left.serviceName.localeCompare(right.serviceName);
  });
}

function focusedBalance(action: AiRevenueAction, relatedActions: AiRevenueAction[] = []) {
  const serviceName = focusedServiceName(action);
  const evidenceRemaining = evidenceNumber(action, ["Focused treatment remaining"]);
  const evidencePurchased = evidenceNumber(action, ["Focused treatment purchased"]);
  const evidenceUsed = evidenceNumber(action, ["Focused treatment used"]);
  const evidenceLastUsedAt = text(findEvidence(action, ["Focused treatment last usage"]));
  const balances = collectServiceBalances(action, relatedActions);
  const matched = balances.find((item) => serviceMatches(item.serviceName, serviceName));

  return {
    serviceName: serviceName || matched?.serviceName || "Treatment",
    remaining: matched?.remaining ?? evidenceRemaining ?? null,
    purchased: matched?.purchased ?? evidencePurchased ?? null,
    used: matched?.used ?? evidenceUsed ?? null,
    lastUsedAt: matched?.lastUsedAt || evidenceLastUsedAt || lastUsageDate(action),
  };
}

function otherRemainingBalances(action: AiRevenueAction, relatedActions: AiRevenueAction[] = []) {
  const focus = focusedServiceName(action);
  return collectServiceBalances(action, relatedActions).filter(
    (item) => (item.remaining ?? 0) > 0 && !serviceMatches(item.serviceName, focus),
  );
}

function balanceLabel(balance: Pick<ServiceBalance, "remaining" | "purchased" | "used">) {
  if (balance.remaining == null) {
    return "Remaining count unknown";
  }
  if (balance.purchased != null && balance.purchased > 0) {
    return `${formatNumber(balance.remaining)} / ${formatNumber(balance.purchased)} sessions remaining`;
  }
  if (balance.used != null && balance.used > 0) {
    return `${formatNumber(balance.remaining)} sessions remaining, ${formatNumber(balance.used)} used`;
  }
  return `${formatNumber(balance.remaining)} sessions remaining`;
}

function inferredUsed(balance: Pick<ServiceBalance, "remaining" | "purchased" | "used">) {
  if (balance.used != null) {
    return balance.used;
  }
  if (balance.purchased != null && balance.remaining != null) {
    return Math.max(0, balance.purchased - balance.remaining);
  }
  return null;
}

function balanceStatus(balance: TreatmentBalanceRow) {
  if (balance.remaining == null) {
    return { label: balance.isFocused ? "Focus" : "Review", tone: "neutral" };
  }
  if (balance.remaining <= 0) {
    return { label: balance.isFocused ? "Focus" : "Completed", tone: "complete" };
  }
  if (balance.remaining <= 3) {
    return { label: "Low remaining", tone: "low" };
  }
  return { label: "Active", tone: "active" };
}

function otherBalanceSentence(action: AiRevenueAction, relatedActions: AiRevenueAction[] = []) {
  const balances = otherRemainingBalances(action, relatedActions);
  if (balances.length === 0) {
    return "";
  }
  return balances.map((item) => `${item.serviceName} ${formatNumber(item.remaining)}`).join(", ");
}

function buildTreatmentBalanceRows(action: AiRevenueAction, relatedActions: AiRevenueAction[] = []): TreatmentBalanceRow[] {
  const focus = focusedBalance(action, relatedActions);
  const balances = collectServiceBalances(action, relatedActions);
  const focusedMatch = balances.find((item) => serviceMatches(item.serviceName, focus.serviceName));
  const focusedRow: TreatmentBalanceRow = {
    key: `focused:${normalizeText(focus.serviceName)}`,
    serviceName: focus.serviceName,
    packageName: focusedMatch?.packageName ?? "",
    remaining: focus.remaining ?? focusedMatch?.remaining ?? null,
    purchased: focus.purchased ?? focusedMatch?.purchased ?? null,
    used: focus.used ?? focusedMatch?.used ?? null,
    lastUsedAt: focus.lastUsedAt || focusedMatch?.lastUsedAt || lastUsageDate(action),
    source: "focused",
    isFocused: true,
    note:
      (focus.remaining ?? focusedMatch?.remaining ?? 0) > 0
        ? "Same treatment still has package balance"
        : "Highlight as the last/preferred treatment",
  };

  const otherRows = balances
    .filter((item) => !serviceMatches(item.serviceName, focus.serviceName))
    .filter((item) => (item.remaining ?? 0) > 0)
    .map<TreatmentBalanceRow>((item) => ({
      ...item,
      isFocused: false,
      note: "Good package utilization follow-up",
    }));

  return [focusedRow, ...otherRows].sort((left, right) => {
    if (left.isFocused !== right.isFocused) {
      return left.isFocused ? -1 : 1;
    }
    return (right.remaining ?? -1) - (left.remaining ?? -1) || left.serviceName.localeCompare(right.serviceName);
  });
}

export function getReturnScore(
  action: AiRevenueAction,
  relatedActions: AiRevenueAction[] = [],
): {
  band: ScoreBand;
  label: string;
  description: string;
} {
  const focus = focusedBalance(action, relatedActions);
  const remaining = remainingUnits(action);
  const otherBalances = otherRemainingBalances(action, relatedActions);
  const inactiveDays = daysSinceLastVisit(action) ?? 0;
  const purchased = purchasedUnits(action);
  const hasSameTreatmentRemaining = (focus.remaining ?? 0) > 0;
  const hasOtherRemaining = otherBalances.some((item) => (item.remaining ?? 0) > 0);
  const hasPackageHistory = remaining > 0 || purchased > 0 || hasSameTreatmentRemaining || hasOtherRemaining;
  const customerValue = totalSpend(action);
  let score = action.priorityScore;

  if (hasSameTreatmentRemaining) {
    score += 25;
  } else if (hasOtherRemaining) {
    score += 14;
  } else if (remaining > 0) {
    score += remaining >= 3 ? 18 : 12;
  }
  if (hasPackageHistory) {
    score += 8;
  }
  if (inactiveDays >= 30 && inactiveDays <= 180) {
    score += 8;
  }
  if (inactiveDays > 365 && !hasSameTreatmentRemaining && !hasOtherRemaining) {
    score -= 8;
  }
  if (customerValue) {
    score += 6;
  }

  if (score >= 82) {
    return {
      band: "high",
      label: "ပြန်လာနိုင်ချေ မြင့်",
      description: "Session ကျန်ရှိမှု၊ မလာရောက်သေးသောရက်၊ ဝယ်ယူမှုမှတ်တမ်းအပေါ်မူတည်သည်။",
    };
  }

  if (score >= 55) {
    return {
      band: "medium",
      label: "ပြန်လာနိုင်ချေ အသင့်အတင့်",
      description: "Customer history ကိုစစ်ပြီး follow-up လုပ်ရန်သင့်သည်။",
    };
  }

  return {
    band: "low",
    label: "ပြန်လာနိုင်ချေ နည်း",
    description: "ပေါ့ပေါ့ပါးပါး follow-up သို့မဟုတ် အချိန်ကောင်းကိုစောင့်ရန်သင့်သည်။",
  };
}

export function buildBusinessReasons(action: AiRevenueAction, relatedActions: AiRevenueAction[] = []) {
  const reasons = new Set<string>();
  const remaining = remainingUnits(action);
  const inactiveDays = daysSinceLastVisit(action);
  const focus = focusedBalance(action, relatedActions);
  const hasOtherRemaining = otherRemainingBalances(action, relatedActions).length > 0;

  if (action.actionType === "service_reminder_overdue" || action.actionType === "service_reminder_follow_up") {
    reasons.add("ကုသမှု follow-up အချိန်ရောက်");
  }
  if ((focus.remaining ?? 0) > 0) {
    reasons.add("နောက်ဆုံးကုသမှု session ကျန်ရှိ");
  }
  if (action.actionType === "unused_package_follow_up" || remaining > 0 || hasOtherRemaining) {
    reasons.add("Package/session ကျန်ရှိ");
  }
  if (hasOtherRemaining) {
    reasons.add("အခြားဝန်ဆောင်မှု balance ရှိ");
  }
  if (action.actionType === "appointment_confirmation_reminder") {
    reasons.add("Appointment reminder လိုအပ်");
  }
  if (action.actionType === "no_show_recovery") {
    reasons.add("No-show ပြန်ခေါ်ရန်");
  }
  if (action.actionType === "cancelled_appointment_recovery") {
    reasons.add("Cancel ပြီး ပြန်ချိန်းရန်");
  }
  if (action.actionType === "inactive_vip_recovery") {
    reasons.add("တန်ဖိုးမြင့် customer");
  }
  if ((inactiveDays ?? 0) >= 30) {
    reasons.add("ရက် ၃၀ ကျော် မလာရောက်");
  }
  if (action.priority === "high" || action.priorityScore >= 75 || (focus.remaining ?? 0) > 0) {
    reasons.add("ပြန်ဝယ်/ပြန်လာနိုင်ချေရှိ");
  }
  if (text(findEvidence(action, ["Expiry date", "Package expiry date", "Expired date"]))) {
    reasons.add("Package expire နီး");
  }

  return [...reasons];
}

export function myanmarReason(action: AiRevenueAction, relatedActions: AiRevenueAction[] = []) {
  const customerName = action.customer.customerName ?? "ဒီ customer";
  const focus = focusedBalance(action, relatedActions);
  const otherText = otherBalanceSentence(action, relatedActions);
  const inactiveDays = daysSinceLastVisit(action);
  const daysText = formatDurationMyanmar(inactiveDays) || "အချိန်အတော်ကြာ";

  if ((focus.remaining ?? 0) > 0) {
    return `${customerName} သည် နောက်ဆုံး ${focus.serviceName} ကုသမှုလာရောက်ထားပြီး ${balanceLabel(focus)} ရှိနေသေးပါတယ်။ ${daysText} မလာရောက်သေးသောကြောင့် appointment ပြန်ချိန်းပေးရန် အကောင်းဆုံး follow-up ဖြစ်ပါတယ်။`;
  }

  if (otherText) {
    return `${customerName} သည် နောက်ဆုံး ${focus.serviceName} အတွက်လာရောက်ပြီး ${daysText} ရှိပါပြီ။ ${otherText} session များ ကျန်ရှိနေသောကြောင့် package အသုံးပြုရန် ပြန်ခေါ်သင့်ပါတယ်။`;
  }

  if (action.actionType === "unused_package_follow_up") {
    const remaining = remainingUnits(action);
    return `${customerName} တွင် ဝယ်ထားသော package/service session ${formatNumber(remaining)} ခု ကျန်ရှိနေပြီး မကြာသေးမီက အသုံးမပြုထားသောကြောင့် appointment ပြန်ချိန်းပေးရန် သင့်ပါတယ်။`;
  }

  if (action.actionType === "appointment_confirmation_reminder") {
    return `${customerName} ၏ appointment ကို confirm/reschedule/cancel လုပ်နိုင်ရန် human-approved reminder ပို့ရန်လိုအပ်ပါတယ်။`;
  }

  if (action.actionType === "no_show_recovery") {
    return `${customerName} သည် appointment မလာရောက်ခဲ့သောကြောင့် အဆင်ပြေသောအချိန်အသစ် ပြန်ချိန်းပေးနိုင်ရန် follow-up လုပ်သင့်ပါတယ်။`;
  }

  if (action.actionType === "cancelled_appointment_recovery") {
    return `${customerName} ၏ appointment cancel ဖြစ်ထားသောကြောင့် future booking မရှိပါက ပြန်ချိန်းပေးရန် ဆက်သွယ်သင့်ပါတယ်။`;
  }

  if (action.actionType === "inactive_vip_recovery") {
    return `${customerName} သည် တန်ဖိုးမြင့် customer ဖြစ်ပြီး မကြာသေးမီက မလာရောက်ထားသောကြောင့် owner/staff မှ personal follow-up လုပ်ရန်သင့်ပါတယ်။`;
  }

  return `${customerName} အတွက် available data အရ follow-up လုပ်ရန် အခွင့်အလမ်းရှိပါတယ်။ ${action.reason}`;
}

export function buildPurchaseSummary(action: AiRevenueAction, relatedActions: AiRevenueAction[] = []): InsightRow[] {
  const rows: InsightRow[] = [];
  const focus = focusedBalance(action, relatedActions);
  const otherBalances = otherRemainingBalances(action, relatedActions);
  const packageName = text(action.packageInfo.packageName);
  const serviceName = text(action.service.serviceName);
  const remaining = remainingUnits(action);
  const purchased = purchasedUnits(action);
  const used = usedUnits(action);
  const lastDate = lastUsageDate(action);
  const spend = totalSpend(action);
  const purchasedOn = purchaseDate(action);

  rows.push({
    label: "Focused treatment",
    value: focus.serviceName || serviceName || "Not available",
    helper: focus.remaining != null ? balanceLabel(focus) : "Highlighted from last treatment or AI source",
  });
  rows.push({
    label: "Other remaining services",
    value:
      otherBalances.length > 0
        ? otherBalances.map((item) => `${item.serviceName}: ${formatNumber(item.remaining)}`).join(", ")
        : "No other balance found",
    helper: otherBalances.length > 0 ? "Useful for package utilization follow-up" : "Depends on loaded package data",
  });
  rows.push({
    label: "Purchased packages",
    value: packageName || (otherBalances.length > 0 ? "Multiple package balances" : "Not available"),
  });
  rows.push({
    label: "Remaining sessions",
    value: purchased > 0 ? `${formatNumber(remaining)} / ${formatNumber(purchased)}` : `${formatNumber(remaining)}`,
    helper: used > 0 ? `${formatNumber(used)} already used` : undefined,
  });
  rows.push({
    label: "Purchase date",
    value: purchasedOn || "Not available",
  });
  rows.push({
    label: "Last visit",
    value: lastDate || "Not available",
    helper: formatDurationAgo(daysSinceLastVisit(action)) || undefined,
  });
  rows.push({
    label: "Total spending",
    value: spend || formatMoney(action.revenue.actualRevenue || action.revenue.influencedRevenue),
  });

  return rows;
}

export function buildUsageTimeline(action: AiRevenueAction, relatedActions: AiRevenueAction[] = []): TimelineItem[] {
  const timeline: TimelineItem[] = [];
  const focus = focusedBalance(action, relatedActions);
  const otherBalances = otherRemainingBalances(action, relatedActions);
  const purchased = purchasedUnits(action);
  const used = usedUnits(action);
  const remaining = remainingUnits(action);
  const purchasedOn = purchaseDate(action);
  const lastDate = lastUsageDate(action);
  const inactiveDays = daysSinceLastVisit(action);

  if (purchasedOn) {
    timeline.push({
      label: "Package purchased",
      value: purchasedOn,
      helper: purchased > 0 ? `${formatNumber(purchased)} session(s)` : undefined,
    });
  }
  if (lastDate) {
    timeline.push({
      label: "Last usage",
      value: lastDate,
      helper: formatDurationSince(inactiveDays) || undefined,
    });
  }
  if (focus.serviceName) {
    timeline.push({
      label: "Focused treatment",
      value: focus.serviceName,
      helper: focus.remaining != null ? balanceLabel(focus) : "Use this as the first follow-up topic",
    });
  }
  if (otherBalances.length > 0) {
    timeline.push({
      label: "Other balance",
      value: otherBalances.map((item) => `${item.serviceName} ${formatNumber(item.remaining)}`).join(", "),
      helper: "Can be mentioned if customer is interested in using remaining sessions",
    });
  }
  if (purchased > 0 || used > 0 || remaining > 0) {
    timeline.push({
      label: "Current balance",
      value: `${formatNumber(remaining)} remaining`,
      helper: purchased > 0 ? `${formatNumber(used)} used of ${formatNumber(purchased)}` : undefined,
    });
  }

  return timeline;
}

export function quickAnswer(action: AiRevenueAction, relatedActions: AiRevenueAction[] = []) {
  const focus = focusedBalance(action, relatedActions);
  const inactiveDays = daysSinceLastVisit(action);
  const otherText = otherBalanceSentence(action, relatedActions);

  if ((focus.remaining ?? 0) > 0) {
    return `အခုဆက်သွယ်ပါ: ${focus.serviceName} အတွက် ${balanceLabel(focus)} ရှိနေသေးပါတယ်။`;
  }
  if (otherText) {
    return `အခုဆက်သွယ်ပါ: ${focus.serviceName} ကို highlight လုပ်ပြီး ${otherText} ကျန်ရှိနေကြောင်း ပြောနိုင်ပါတယ်။`;
  }
  if (inactiveDays != null && inactiveDays >= 30) {
    return `အခုဆက်သွယ်ပါ: ${focus.serviceName} အတွက် နောက်ဆုံးလာရောက်ပြီး ${formatDurationMyanmar(inactiveDays)} ရှိပါပြီ။`;
  }
  return action.summary || `${focus.serviceName} အတွက် follow-up လုပ်ရန်သင့်ပါတယ်။`;
}

export function AiOpportunityScoreBadge({
  action,
  relatedActions = [],
}: {
  action: AiRevenueAction;
  relatedActions?: AiRevenueAction[];
}) {
  const score = getReturnScore(action, relatedActions);

  return (
    <div className={`ai-followup-score ai-followup-score--${score.band}`}>
      <strong>{score.label}</strong>
      <span>{score.description}</span>
    </div>
  );
}

export function AiReasonChips({
  action,
  relatedActions = [],
}: {
  action: AiRevenueAction;
  relatedActions?: AiRevenueAction[];
}) {
  const reasons = buildBusinessReasons(action, relatedActions);

  return (
    <div className="ai-followup-reasons" aria-label="AI recommendation reasons">
      {reasons.map((reason) => (
        <span key={reason}>{reason}</span>
      ))}
    </div>
  );
}

export function AiFocusedServicePanel({
  action,
  relatedActions = [],
}: {
  action: AiRevenueAction;
  relatedActions?: AiRevenueAction[];
}) {
  const focus = focusedBalance(action, relatedActions);
  const otherBalances = otherRemainingBalances(action, relatedActions);

  return (
    <div className="ai-followup-balance-panel">
      <div className="ai-followup-focus-treatment">
        <span>အဓိက follow-up ဝန်ဆောင်မှု</span>
        <strong>{focus.serviceName}</strong>
        <small>{focus.remaining != null ? balanceLabel(focus) : "နောက်ဆုံးလာရောက်ထားသော treatment ကို highlight လုပ်ထားသည်"}</small>
      </div>
      <div className="ai-followup-other-services">
        <span>အခြားကျန်ရှိနေသော services</span>
        {otherBalances.length > 0 ? (
          <div>
            {otherBalances.map((item) => (
              <strong key={item.key}>
                {item.serviceName}
                <small>{balanceLabel(item)}</small>
              </strong>
            ))}
          </div>
        ) : (
          <p>No other remaining service balance found in loaded data.</p>
        )}
      </div>
    </div>
  );
}

export function AiCustomerContextStrip({
  action,
  relatedActions = [],
}: {
  action: AiRevenueAction;
  relatedActions?: AiRevenueAction[];
}) {
  const focus = focusedBalance(action, relatedActions);
  const inactiveDays = daysSinceLastVisit(action);
  const spend = totalSpend(action);
  const lastDate = lastUsageDate(action);

  return (
    <div className="ai-followup-context-strip">
      <div>
        <span>Follow-up service</span>
        <strong>{focus.serviceName}</strong>
        <small>{focus.remaining != null ? balanceLabel(focus) : "Use as the first contact topic"}</small>
      </div>
      <div>
        <span>Last visit</span>
        <strong>{lastDate || "Not available"}</strong>
        <small>{formatDurationAgo(inactiveDays) || "Visit gap unavailable"}</small>
      </div>
      <div>
        <span>Customer value</span>
        <strong>{spend || formatMoney(action.revenue.actualRevenue || action.revenue.influencedRevenue)}</strong>
        <small>{action.customer.phoneNumber || action.customer.phoneMasked || "Contact detail not available"}</small>
      </div>
    </div>
  );
}

export function AiTreatmentBalanceTable({
  action,
  relatedActions = [],
}: {
  action: AiRevenueAction;
  relatedActions?: AiRevenueAction[];
}) {
  const rows = buildTreatmentBalanceRows(action, relatedActions);

  return (
    <div className="ai-followup-treatment-table-wrap">
      <table className="ai-followup-treatment-table">
        <thead>
          <tr>
            <th>Service</th>
            <th>Package Total</th>
            <th>Used</th>
            <th>Remaining</th>
            <th>Latest Usage</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const status = balanceStatus(row);
            const used = inferredUsed(row);
            return (
              <tr key={row.key} className={row.isFocused ? "ai-followup-treatment-table__focused-row" : undefined}>
                <td>
                  <strong>{row.serviceName}</strong>
                  <small>{row.note}</small>
                </td>
                <td>{row.purchased != null ? formatNumber(row.purchased) : "—"}</td>
                <td>{used != null ? formatNumber(used) : "—"}</td>
                <td>
                  <strong>{row.remaining != null ? formatNumber(row.remaining) : "—"}</strong>
                </td>
                <td>{row.lastUsedAt || "—"}</td>
                <td>
                  <span className={`ai-followup-balance-status ai-followup-balance-status--${status.tone}`}>
                    {status.label}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function AiPurchaseSummary({
  action,
  relatedActions = [],
}: {
  action: AiRevenueAction;
  relatedActions?: AiRevenueAction[];
}) {
  return (
    <div className="ai-followup-summary-grid">
      {buildPurchaseSummary(action, relatedActions).map((row) => (
        <div key={row.label} className="ai-followup-summary-item">
          <span>{row.label}</span>
          <strong>{row.value}</strong>
          {row.helper ? <small>{row.helper}</small> : null}
        </div>
      ))}
    </div>
  );
}

export function AiPackageUsageTimeline({
  action,
  relatedActions = [],
}: {
  action: AiRevenueAction;
  relatedActions?: AiRevenueAction[];
}) {
  const timeline = buildUsageTimeline(action, relatedActions);
  if (timeline.length === 0) {
    return null;
  }

  return (
    <div className="ai-followup-timeline">
      {timeline.map((item) => (
        <div key={`${item.label}-${item.value}`} className="ai-followup-timeline__item">
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.helper ? <small>{item.helper}</small> : null}
        </div>
      ))}
    </div>
  );
}

export function AiFollowUpSnapshot({
  action,
  relatedActions = [],
}: {
  action: AiRevenueAction;
  relatedActions?: AiRevenueAction[];
}) {
  return (
    <section className="ai-followup-snapshot">
      <div className="ai-followup-snapshot__intro">
        <div>
          <span>AI အကြံပြုချက် (Myanmar)</span>
          <strong>{myanmarReason(action, relatedActions)}</strong>
        </div>
        <AiOpportunityScoreBadge action={action} relatedActions={relatedActions} />
      </div>
      <AiReasonChips action={action} relatedActions={relatedActions} />
      <AiCustomerContextStrip action={action} relatedActions={relatedActions} />
      <div className="ai-followup-section">
        <div className="ai-followup-section__header">
          <strong>Service usage and remaining balance</strong>
          <span>Clean package context for staff follow-up</span>
        </div>
        <AiTreatmentBalanceTable action={action} relatedActions={relatedActions} />
      </div>
    </section>
  );
}

export { daysSinceLastVisit, remainingUnits, titleCase };
