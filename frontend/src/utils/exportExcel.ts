export type ExcelCellValue = string | number | boolean | Date | null | undefined;

type DownloadExcelParams = {
  fileName: string;
  headers: string[];
  rows: ExcelCellValue[][];
  sheetName?: string;
};

function toColumnWidth(value: ExcelCellValue) {
  return String(value ?? "").length;
}

export async function downloadExcelWorkbook({
  fileName,
  headers,
  rows,
  sheetName = "Report",
}: DownloadExcelParams) {
  const XLSX = await import("xlsx");
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  worksheet["!cols"] = headers.map((header, columnIndex) => {
    const contentWidth = rows.reduce((maxWidth, row) => {
      return Math.max(maxWidth, toColumnWidth(row[columnIndex]));
    }, toColumnWidth(header));

    return { wch: Math.min(40, Math.max(12, contentWidth + 2)) };
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const excelBuffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "array",
  });
  const blob = new Blob([excelBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${fileName}.xlsx`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function buildDatedExportFileName(prefix: string, fromDate: string, toDate: string) {
  return `${prefix}-${fromDate}-to-${toDate}`;
}

export function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}
