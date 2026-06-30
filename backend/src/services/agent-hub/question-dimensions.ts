export type QuestionDimension = {
  wantsCustomers: boolean;
  wantsServices: boolean;
  wantsPractitioners: boolean;
  wantsSales: boolean;
  wantsAppointments: boolean;
  wantsTreatments: boolean;
  wantsRowLevelRoster: boolean;
  wantsAggregateSummary: boolean;
};

export function parseQuestionDimensions(message: string): QuestionDimension {
  const wantsCustomers = /customers?|members?|clients?|ဖောက်သည်|ဘယ်\s*customers?|ဘယ်\s*customer/i.test(message);
  const wantsServices = /services?|treatments?|packages?|ဝန်ဆောင်မှု|ကုသမှု|ဘာ\s*လုပ်|ဘာ\s*service/i.test(message);
  const wantsPractitioners =
    /therapists?|practitioners?|doctors?|staff|ဆရာဝန်|ဘယ်သူနဲ့|ဘယ်သူက|ဘယ်\s*staff|ဘယ်\s*ဆရာ/i.test(message);
  const wantsSales =
    /sales?|revenue|amount|invoice|payment|collected|sale\s*ဘယ်လောက်|ရောင်းအား|ဝင်ငွေ|ငွေ|ကျသင့်|ပေးချေ/i.test(
      message,
    );
  const wantsAppointments = /appointments?|bookings?|schedule|ချိန်း|ဘိုကင်/i.test(message);
  const wantsTreatments = /treatments?|service\s*ပေး|served|did|လုပ်|ကုသ|ကုသမှု/i.test(message);
  const wantsRowLevelRoster =
    /who|which|list|show|detail|roster|ဘယ်သူ|ဘယ်\s*customers?|ဘယ်\s*customer|ဘယ်\s*service|ဘယ်သူနဲ့|လုပ်လဲ|ကုသလဲ|လုပ်ထားလဲ|service\s*ပေးထားလဲ/i.test(
      message,
    );
  const wantsAggregateSummary =
    /summary|performance|report|top|most|ranking|count|total|အများဆုံး|စုစုပေါင်း|performance\s*report|summary\s*ပြ/i.test(
      message,
    );

  return {
    wantsCustomers,
    wantsServices,
    wantsPractitioners,
    wantsSales,
    wantsAppointments,
    wantsTreatments,
    wantsRowLevelRoster,
    wantsAggregateSummary,
  };
}

export function isAppointmentRosterQuestion(message: string) {
  const dimensions = parseQuestionDimensions(message);
  const hasAppointmentCue = dimensions.wantsAppointments;
  const rowCue = dimensions.wantsRowLevelRoster || /စာရင်း|ဘယ်|which|who|list|show|detail|roster/i.test(message);
  const countOnlyCue = /how\s+many|count|total|ဘယ်နှစ်|စုစုပေါင်း/i.test(message) && !rowCue;

  return hasAppointmentCue && rowCue && !countOnlyCue;
}

export function isTreatmentRosterQuestion(message: string) {
  const dimensions = parseQuestionDimensions(message);
  const hasRosterDimensions = dimensions.wantsCustomers && dimensions.wantsServices && dimensions.wantsPractitioners;
  const hasTreatmentAction = dimensions.wantsTreatments || /did|served|လုပ်|ကုသ|service\s*ပေး/i.test(message);
  const hasListWithoutSummary = dimensions.wantsRowLevelRoster && !dimensions.wantsAggregateSummary;
  const hasHistoricalOrCompletedCue =
    /yesterday|last\s+(?:day|week|month)|မနေ့|ပြီး|did|served|ကုသလဲ|လုပ်လဲ|လုပ်ထား|completed|finished/i.test(message);

  return (
    hasRosterDimensions &&
    dimensions.wantsRowLevelRoster &&
    (hasTreatmentAction || (hasListWithoutSummary && hasHistoricalOrCompletedCue)) &&
    !dimensions.wantsAppointments
  );
}
