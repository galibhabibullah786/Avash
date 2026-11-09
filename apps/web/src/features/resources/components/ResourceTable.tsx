import type { BloodAvailabilityDto } from "@avash/types";

export interface ResourceTableProps {
  results: BloodAvailabilityDto[];
}

function formatDistance(distanceM: number | null | undefined): string {
  return typeof distanceM === "number" && distanceM > 0
    ? `${(distanceM / 1000).toFixed(1)} km`
    : "—";
}

function formatUpdatedAt(updatedAt: string | null | undefined): string {
  return updatedAt ? new Date(updatedAt).toLocaleTimeString() : "—";
}

export function ResourceTable({ results }: ResourceTableProps) {
  return (
    <div
      className="chart-panel report-table-panel"
      style={{ padding: "0" }}
    >
      <div className="responsive-table">
        <table data-testid="status-success" className="w-full max-md:block">
          <thead className="max-md:hidden">
            <tr>
              <th style={{ paddingLeft: "25px", paddingTop: "18px" }}>
                হাসপাতালের নাম
              </th>
              <th style={{ paddingTop: "18px" }}>ঠিকানা</th>
              <th style={{ paddingTop: "18px" }}>যোগাযোগ</th>
              <th style={{ paddingTop: "18px" }}>মোট রক্ত (Units)</th>
              <th style={{ paddingTop: "18px" }}>প্লাটিলেট (Platelets)</th>
              <th style={{ paddingTop: "18px" }}>দূরত্ব</th>
              <th style={{ paddingRight: "25px", paddingTop: "18px" }}>
                সর্বশেষ আপডেট
              </th>
            </tr>
          </thead>
          <tbody className="max-md:block">
            {results.map((row, index) => {
              const isLast = index === results.length - 1;
              return (
                <tr
                  key={row?.inventoryId}
                  data-testid="hospital-row"
                  className="max-md:block max-md:mb-4 max-md:border max-md:border-[var(--color-border)] max-md:rounded-lg max-md:p-4 max-md:bg-[var(--color-surface)]"
                >
                  <td
                    className="max-md:flex max-md:justify-between max-md:items-center max-md:py-2 max-md:border-b max-md:border-dashed max-md:border-[var(--color-border)] max-md:!p-2 max-md:!pb-2"
                    style={{
                      paddingLeft: "25px",
                      paddingBottom: isLast ? "18px" : undefined,
                    }}
                  >
                    <span className="md:hidden font-bold text-[var(--color-text-muted)] mr-4">নাম</span>
                    <span className="max-md:text-right">
                      {row?.hospital?.name ?? "—"}
                      {row?.hospital?.verified ? (
                        <span
                          className="table-badge table-badge--medium"
                          style={{ marginLeft: "8px" }}
                        >
                          যাচাইকৃত
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td
                    className="max-md:flex max-md:justify-between max-md:items-center max-md:py-2 max-md:border-b max-md:border-dashed max-md:border-[var(--color-border)] max-md:!p-2 max-md:!pb-2"
                    style={{ paddingBottom: isLast ? "18px" : undefined }}
                  >
                    <span className="md:hidden font-bold text-[var(--color-text-muted)] mr-4">ঠিকানা</span>
                    <span className="max-md:text-right break-words max-w-[220px]">{row?.hospital?.address ?? "—"}</span>
                  </td>

                  <td
                    className="max-md:flex max-md:justify-between max-md:items-center max-md:py-2 max-md:border-b max-md:border-dashed max-md:border-[var(--color-border)] max-md:!p-2 max-md:!pb-2"
                    style={{ paddingBottom: isLast ? "18px" : undefined }}
                  >
                    <span className="md:hidden font-bold text-[var(--color-text-muted)] mr-4">যোগাযোগ</span>
                    <span className="max-md:text-right">
                      {row?.hospital?.phone ? (
                        <a
                          href={`tel:${row.hospital.phone}`}
                          className="inline-flex items-center gap-1.5 text-[var(--color-primary)] font-bold hover:underline min-h-[44px] py-1 px-2.5 rounded bg-[var(--color-surface-subtle)] border border-[var(--color-border)] text-xs md:text-sm"
                          aria-label={`${row.hospital.name || 'হাসপাতাল'} এর ফোন নম্বরে কল করুন`}
                        >
                          <span aria-hidden="true">📞</span>
                          <span>{row.hospital.phone}</span>
                        </a>
                      ) : (
                        "—"
                      )}
                    </span>
                  </td>
                  <td
                    className="max-md:flex max-md:justify-between max-md:items-center max-md:py-2 max-md:border-b max-md:border-dashed max-md:border-[var(--color-border)] max-md:!p-2 max-md:!pb-2"
                    style={{ paddingBottom: isLast ? "18px" : undefined }}
                  >
                    <span className="md:hidden font-bold text-[var(--color-text-muted)] mr-4">মোট রক্ত</span>
                    <span className="max-md:text-right font-bold text-sm">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                        (row?.unitsAvailable ?? 0) === 0
                          ? 'bg-[var(--color-danger-light)] text-[var(--color-danger)]'
                          : (row?.unitsAvailable ?? 0) <= 2
                          ? 'bg-[var(--color-warning-light)] text-[var(--color-warning)]'
                          : 'bg-[var(--color-safe-light)] text-[var(--color-safe)]'
                      }`}>
                        {row?.unitsAvailable ?? 0} ব্যাগ
                      </span>
                    </span>
                  </td>
                  <td
                    className="max-md:flex max-md:justify-between max-md:items-center max-md:py-2 max-md:border-b max-md:border-dashed max-md:border-[var(--color-border)] max-md:!p-2 max-md:!pb-2"
                    style={{ paddingBottom: isLast ? "18px" : undefined }}
                  >
                    <span className="md:hidden font-bold text-[var(--color-text-muted)] mr-4">প্লাটিলেট</span>
                    <span className="max-md:text-right font-bold text-sm">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                        (row?.plateletUnits ?? 0) === 0
                          ? 'bg-[var(--color-danger-light)] text-[var(--color-danger)]'
                          : (row?.plateletUnits ?? 0) <= 2
                          ? 'bg-[var(--color-warning-light)] text-[var(--color-warning)]'
                          : 'bg-[var(--color-safe-light)] text-[var(--color-safe)]'
                      }`}>
                        {row?.plateletUnits ?? 0} ব্যাগ
                      </span>
                    </span>
                  </td>
                  <td
                    className="max-md:flex max-md:justify-between max-md:items-center max-md:py-2 max-md:border-b max-md:border-dashed max-md:border-[var(--color-border)] max-md:!p-2 max-md:!pb-2"
                    style={{ paddingBottom: isLast ? "18px" : undefined }}
                  >
                    <span className="md:hidden font-bold text-[var(--color-text-muted)] mr-4">দূরত্ব</span>
                    <span className="max-md:text-right">{formatDistance(row?.distanceM)}</span>
                  </td>
                  <td
                    className="max-md:flex max-md:justify-between max-md:items-center max-md:py-2 max-md:border-0 max-md:!p-2 max-md:!pb-2"
                    style={{
                      paddingRight: "25px",
                      paddingBottom: isLast ? "18px" : undefined,
                    }}
                  >
                    <span className="md:hidden font-bold text-[var(--color-text-muted)] mr-4">হালনাগাদ</span>
                    <span className="max-md:text-right">{formatUpdatedAt(row?.updatedAt)}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
