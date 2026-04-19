import fs from 'fs';
import path from 'path';
import { extractCanonicalRowsFromPdf } from '../src/lib/pdfImport.js';

async function main() {
  const sample = path.resolve(process.cwd(), 'fake_contract_products_with_logo.pdf');
  if (!fs.existsSync(sample)) {
    console.error('Sample PDF not found at', sample);
    process.exit(2);
  }

  try {
    const buf = await fs.promises.readFile(sample);
    const extraction = await extractCanonicalRowsFromPdf(buf, 'fake_contract_products_with_logo.pdf');
    console.log('Extraction log:', JSON.stringify(extraction.statusLog, null, 2));
    console.log('Extracted rows:', JSON.stringify(extraction.rows.slice(0, 20), null, 2));
    console.log('Total rows:', extraction.rows.length);
  } catch (err) {
    console.error('Extraction failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

void main();
