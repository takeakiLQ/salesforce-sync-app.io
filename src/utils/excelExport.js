// 画面の表を .xlsx にして保存させる。
//
// 何をどの列に出すかは呼び出し側（各ページ）が決め、ここは書き出し方だけを持つ。
// ExcelJS は大きい（圧縮後でも数百KB）ので、押されたときに初めて読み込む。
// 普段の画面表示には載せない。
//
// sheets: [{
//   name,                      シート名（31文字まで、: \ / ? * [ ] は不可）
//   columns: [{ header, width, numFmt, wrap }],
//   rows: [[値, ...], ...],    値は 数値 / 文字列 / Date / null / { text, hyperlink }
//   totalRow: [値, ...],       省略可。最終行に太字で足す
//   table: false,              false なら見出しの固定とフィルタを付けない（出力条件など）
//   colorScale: true,          1行目・1列目を除いた範囲を、値が大きいほど濃い青に塗る
// }]

const HEADER_FILL = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE8EEF7" },
};

const LINK_FONT = { color: { argb: "FF1D4ED8" }, underline: true };

/** NaN や undefined を空セルにする（Excel に "NaN" と出さない） */
const cleanValue = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  return value;
};

const addSheet = (workbook, { name, columns, rows, totalRow, table = true, colorScale }) => {
  const sheet = workbook.addWorksheet(name, {
    views: table ? [{ state: "frozen", ySplit: 1 }] : [],
  });

  sheet.columns = columns.map((column) => ({
    header: column.header,
    width: column.width || 12,
    style: {
      numFmt: column.numFmt,
      alignment: { vertical: "top", wrapText: Boolean(column.wrap) },
    },
  }));

  const header = sheet.getRow(1);
  header.font = { bold: true };
  header.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  if (table) {
    header.eachCell((cell) => {
      cell.fill = HEADER_FILL;
    });
  }

  rows.forEach((values) => {
    const row = sheet.addRow(values.map(cleanValue));
    row.eachCell((cell) => {
      if (cell.value && typeof cell.value === "object" && cell.value.hyperlink) {
        cell.font = LINK_FONT;
      }
    });
  });

  if (totalRow) {
    const row = sheet.addRow(totalRow.map(cleanValue));
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.border = { top: { style: "thin" } };
    });
  }

  // 画面のヒートマップと同じく、多いほど濃い青。0 は白
  if (colorScale && rows.length && columns.length > 1) {
    const last = sheet.getRow(1 + rows.length).getCell(columns.length).address;
    sheet.addConditionalFormatting({
      ref: `B2:${last}`,
      rules: [
        {
          type: "colorScale",
          cfvo: [{ type: "num", value: 0 }, { type: "max" }],
          color: [{ argb: "FFFFFFFF" }, { argb: "FF0366D6" }],
        },
      ],
    });
  }

  if (table && rows.length) {
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1 + rows.length, column: columns.length },
    };
  }
};

/** ブラウザに保存させる。iOS Safari も a[download] で保存ダイアログになる */
const saveBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // すぐ revoke すると保存が始まる前に消える端末があるので少し待つ
  setTimeout(() => URL.revokeObjectURL(url), 10000);
};

export async function downloadWorkbook({ fileName, sheets, creator }) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  // ファイルのプロパティ（作成者）にも残す
  if (creator) workbook.creator = creator;

  sheets.forEach((sheet) => addSheet(workbook, sheet));

  const buffer = await workbook.xlsx.writeBuffer();
  saveBlob(
    new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
    fileName
  );
}

/* ===== 値の変換 ===== */

/**
 * "2026-04-01" → Excel の日付。
 * ExcelJS は Date を UTC で書くので、UTC の0時にしておかないと日本時間で前日にずれる。
 */
export const toExcelDate = (text) => {
  const matched = String(text ?? "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!matched) return null;
  const [year, month, day] = matched.slice(1).map(Number);
  return new Date(Date.UTC(year, month - 1, day));
};

/** 時間（13.5）→ Excel の時刻（1日 = 1）。表示形式 h:mm と組み合わせる */
export const toExcelTime = (hours) =>
  Number.isFinite(hours) ? hours / 24 : null;

/** 「案件分析_20261001_1530.xlsx」 */
export const timestampedFileName = (prefix, now = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  return (
    `${prefix}_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}.xlsx`
  );
};
