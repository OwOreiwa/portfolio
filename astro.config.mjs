// @ts-check

import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
	site: 'https://OwOreiwa.github.io',
	base: '/personal',
	integrations: [mdx(), sitemap()],
	build: {
    inlineStylesheets: 'never',
		assets: 'assets',
  },
	vite: {
    build: {
      rollupOptions: {
        output: {
          assetFileNames: (assetInfo) => {
            let extType = assetInfo.names[0].split('.').at(-1);
            if (extType && /png|jpe?g|svg|gif|webp|ico/i.test(extType)) extType = 'img';
            if (extType && /css|scss/i.test(extType)) extType = 'css';
            return `assets/${extType}/[name][extname]`;
          },
        },
      },
			assetsInlineLimit: 0,
			cssCodeSplit: false,
    },
  },
});
