import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const SITE_DATA_DIR = path.join(ROOT, 'site', 'data');

export const paths = {
  catalog: path.join(DATA_DIR, 'catalog.json'),
  shops: path.join(DATA_DIR, 'shops.json'),
  resolved: path.join(DATA_DIR, 'resolved.json'),
  history: path.join(DATA_DIR, 'history.json'),
  report: path.join(DATA_DIR, 'report.json'),
  sitePrices: path.join(SITE_DATA_DIR, 'prices.json'),
};
