const fs = require("fs");
const { PDFParse } = require("pdf-parse");
(async () => {
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(process.env.PDF_IN)) });
  const res = await parser.getImage();
  let n = 0;
  for (const pg of res.pages || []) {
    for (const img of pg.images || []) {
      if (!img.data) continue;
      const f = `${process.env.OUT_DIR}/p${String(pg.pageNumber).padStart(2,"0")}_${n++}.png`;
      fs.writeFileSync(f, Buffer.from(img.data));
    }
  }
  console.log("imagenes extraidas:", n);
  await parser.destroy();
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
