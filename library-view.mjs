import { filterLibrary, ownerKey } from './library-engine.mjs';

const names = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });
const timestamp = value => typeof value === 'number' ? value : Date.parse(value) || 0;

/** Group before paginating: a bot is never split across multiple overview pages. */
export function groupLibrary(entries, options = {}) {
    const groups = new Map();
    for (const entry of filterLibrary(entries, options)) {
        const key = ownerKey(entry);
        let group = groups.get(key);
        if (!group) {
            group = { key, kind: entry.kind, ownerId: entry.ownerId, ownerName: entry.ownerName, entries: [], summaries: 0, memories: 0, updatedAt: 0 };
            groups.set(key, group);
        }
        group.entries.push(entry);
        group.summaries += entry.counts.summaries;
        group.memories += entry.counts.memories;
        group.updatedAt = Math.max(group.updatedAt, timestamp(entry.updatedAt));
    }
    return [...groups.values()].sort((a, b) => {
        const field = ['summaries', 'memories'].includes(options.sort) ? options.sort : options.sort === 'name' ? null : 'updatedAt';
        return (field && b[field] - a[field]) || names.compare(a.ownerName, b.ownerName) || names.compare(a.ownerId, b.ownerId) || names.compare(a.kind, b.kind);
    });
}

export function libraryPage(items, page, size) {
    const pages = Math.max(1, Math.ceil(items.length / size));
    const current = Math.min(Math.max(0, Number.isFinite(page) ? Math.floor(page) : 0), pages - 1);
    return { page: current, pages, total: items.length, items: items.slice(current * size, (current + 1) * size) };
}

export function selectionState(entries, selected) {
    const keys = entries.filter(e => e.hasStore).map(e => e.key);
    const count = keys.reduce((n, key) => n + Number(selected.has(key)), 0);
    return { keys, count, checked: keys.length > 0 && count === keys.length, mixed: count > 0 && count < keys.length };
}

/** Only shorten the exact host-generated name; user titles and the original ID stay intact. */
export function chatLabel(entry) {
    const prefix = `${entry.ownerName} - `;
    const suffix = entry.chatId.startsWith(prefix) ? entry.chatId.slice(prefix.length) : '';
    const match = suffix.match(/^(\d{4})-(\d{2})-(\d{2})@(\d{2})h(\d{2})m\d{2}s\d{1,3}ms$/);
    return match ? `${match[1]}.${match[2]}.${match[3]} · ${match[4]}:${match[5]}` : entry.chatId;
}

/** Resolve on render so cached catalog entries never keep stale avatar URLs. */
export function ownerAvatarSources(owner, context) {
    const thumbnail = file => context.getThumbnailUrl?.('avatar', file) || `/thumbnail?type=avatar&file=${encodeURIComponent(file)}`;
    if (owner.kind === 'character') return [thumbnail(owner.ownerId)];
    const group = context.groups?.find(g => String(g.id) === String(owner.ownerId));
    const custom = group?.avatar_url;
    if (typeof custom === 'string' && (/^data:image\//i.test(custom) || /^\/(?!\/)/.test(custom) || /^user\/images\//.test(custom))) return [custom];
    const available = new Set(context.characters?.map(c => c.avatar) || []);
    return [...new Set(group?.members || [])].filter(file => file && file !== 'none' && available.has(file)).slice(0, 4).map(thumbnail);
}
