export function formatFactor(feature: string, direction: string): string {
  const fMap: Record<string, string> = {
    temp_lag1: "১ সপ্তাহের পূর্বের তাপমাত্রা",
    temp_lag2: "২ সপ্তাহের পূর্বের তাপমাত্রা",
    temp_mean_lag2: "বিগত ২ সপ্তাহের তাপমাত্রা",
    temp_mean: "গড় তাপমাত্রা",
    temp_min: "সর্বনিম্ন তাপমাত্রা",
    temp_max: "সর্বোচ্চ তাপমাত্রা",
    precip_sum: "বৃষ্টিপাতের পরিমাণ",
    precipitation_sum: "ভারী বৃষ্টিপাত",
    humidity_pct: "বাতাসের আর্দ্রতা",
    humidity_mean: "গড় আর্দ্রতা",
    cases_lag1: "পূর্ববর্তী সংক্রমণ",
  };
  const dMap: Record<string, string> = {
    high: "বৃদ্ধি",
    low: "হ্রাস",
    elevated: "উচ্চ মাত্রা",
    positive: "অনুকূল বৃদ্ধি",
    increasing: "ক্রমবর্ধমান",
    decreasing: "হ্রাসমান",
  };
  const fText = fMap[feature] ?? feature.replace(/_/g, " ");
  const dText = dMap[direction] ?? direction;
  return `${fText} (${dText})`;
}
