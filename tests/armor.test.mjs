import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildArmor } from '../tools/armor.mjs';

test('the armor block at the end of style.css is up to date (run node tools/armor.mjs after editing styles)', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    assert.equal(buildArmor(css), css);
});

test('the armor copies only looks, never layout, and keeps the panel scope', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    const block = css.slice(css.indexOf('⟦armor:start⟧'), css.indexOf('⟦armor:end⟧'));
    assert.doesNotMatch(block, /(^|[;{]\s*)(display|position|flex|grid|order|opacity|visibility)\s*:/m);
    assert.match(block, /:is\(#memoria_settings, #memoria_tie_picker\) \.mm-ti-btn/);
});
