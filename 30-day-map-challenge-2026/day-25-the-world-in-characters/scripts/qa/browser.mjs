import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

export const plateUrl = (filename) => pathToFileURL(resolve(filename)).href;
export const launch = () => chromium.launch({
  channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true, args: ['--enable-gpu'],
});

