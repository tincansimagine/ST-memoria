import { createLibraryPost, scanLibrary, filterLibrary, libraryTotals, ownerKey, libraryKey, readLibraryExport, backupFilename, buildLibraryBackup } from './library-engine.mjs';

const CACHE_KEY = 'memoria.libraryIndex.v1';
const PAGE_SIZE = 20;
let opened = false;
const number = value => Number(value || 0).toLocaleString('ko-KR');
const dateLabel = value => {
    const date = new Date(value);
    return value && Number.isFinite(date.getTime()) ? date.toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
};

// Account-scoped cache contains counts and names only, never archive text.
export function readLibraryCache(storage) {
    try {
        const raw = storage?.getItem(CACHE_KEY);
        if (!raw || raw.length > 2_000_000) return null;
        const value = JSON.parse(raw);
        if (value.schema !== 1 || !Number.isFinite(value.at) || !['complete', 'partial', 'cancelled'].includes(value.phase) || !Array.isArray(value.entries) || !Array.isArray(value.errors)) return null;
        if (!value.entries.every(e => ['character', 'group'].includes(e.kind) && typeof e.ownerId === 'string' && typeof e.ownerName === 'string' && typeof e.chatId === 'string' && e.key === libraryKey(e) && ['recorded', 'empty', 'unused', 'review', 'error'].includes(e.state) && e.counts && ['summaries', 'memories', 'turns'].every(k => Number.isFinite(e.counts[k]) && e.counts[k] >= 0))) return null;
        value.entries = value.entries.map(e => ({ ...e, live: false }));
        return value;
    } catch { return null; }
}

export async function showArchiveLibrary({ getContext, getRequestHeaders, download, live, getLiveTarget }) {
    if (opened) return;
    opened = true;
    let controller, disposed = false;
    try {
        const response = await fetch(new URL('./templates/library.html', import.meta.url));
        if (!response.ok) throw new Error('전체 서고 화면을 불러오지 못했습니다. 새로고침 후 다시 시도해 주세요.');
        const $root = $(await response.text());
        const root = $root[0];
        const ui = name => root.querySelector(`[data-ui="${name}"]`);
        const action = name => root.querySelector(`[data-action="${name}"]`);
        const post = createLibraryPost(getRequestHeaders);
        const storage = getContext().accountStorage;
        let snapshot = readLibraryCache(storage), cached = !!snapshot, busy = '', page = 0;
        let selected = new Set();
        let backupErrors = [];
        const filtered = () => filterLibrary(snapshot?.entries || [], { query: ui('search').value, filter: ui('filter').value, sort: ui('sort').value });
        const message = text => { ui('message').textContent = text; ui('message').hidden = !text; };
        const element = (tag, className, text) => {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        };

        function renderErrors() {
            const errors = [...(snapshot?.errors || []), ...backupErrors];
            ui('errors').hidden = !errors.length;
            ui('errors-title').textContent = `확인하지 못한 항목 ${number(errors.length)}개`;
            ui('errors-list').replaceChildren(...errors.map(e => element('li', '', `${e.ownerName || '검사'}${e.chatId ? ` · ${e.chatId}` : ''} — ${e.message}`)));
        }

        function renderSelection() {
            ui('selection').textContent = selected.size ? `채팅 ${number(selected.size)}개 선택` : '채팅을 선택해 주세요';
            action('backup').textContent = selected.size ? `선택 ${number(selected.size)}개 ZIP 백업` : '선택한 서고 ZIP 백업';
            action('backup').disabled = !!busy || !selected.size;
            action('select').disabled = !!busy || !filtered().some(e => e.hasStore);
            action('clear').disabled = !!busy || !selected.size;
        }

        function renderList() {
            const rows = filtered();
            const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
            page = Math.min(page, pages - 1);
            ui('matches').textContent = `${number(rows.length)}개 채팅`;
            ui('page').textContent = `${page + 1} / ${pages}`;
            action('prev').disabled = page === 0;
            action('next').disabled = page >= pages - 1;
            const list = ui('list');
            list.replaceChildren();
            if (!rows.length) {
                const box = element('div', 'ml-empty');
                box.append(element('strong', '', busy === 'scan' ? '기록을 찾고 있어요' : '표시할 채팅이 없어요'), element('p', '', '검색어나 표시 조건을 바꿔 보세요. 빈 서고와 미사용 채팅은 기본 목록에서 제외됩니다.'));
                list.append(box);
            }
            const groups = new Map();
            for (const entry of rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
                const id = ownerKey(entry);
                let group = groups.get(id);
                if (!group) {
                    group = element('section', 'ml-owner');
                    const heading = element('header', 'ml-owner-heading');
                    const title = element('div');
                    title.append(element('strong', '', entry.ownerName), element('small', '', `${entry.kind === 'group' ? '그룹' : '봇'} · ${entry.ownerId}`));
                    heading.append(element('span', 'ml-avatar', entry.kind === 'group' ? '◈' : [...entry.ownerName][0] || 'M'), title);
                    group.append(heading); list.append(group); groups.set(id, group);
                }
                const row = element('div', `ml-chat${selected.has(entry.key) ? ' is-selected' : ''}`);
                const check = element('input'); check.type = 'checkbox'; check.checked = selected.has(entry.key); check.disabled = !!busy || !entry.hasStore;
                check.setAttribute('aria-label', `${entry.ownerName} · ${entry.chatId} 선택`);
                check.addEventListener('change', () => {
                    if (check.checked) selected.add(entry.key); else selected.delete(entry.key);
                    row.classList.toggle('is-selected', check.checked); renderSelection();
                });
                const body = element('div', 'ml-chat-body');
                const title = element('strong', 'ml-chat-title', entry.chatId);
                const badges = element('div', 'ml-badges');
                if (entry.live) badges.append(element('span', 'ml-badge', '현재 채팅'));
                const labels = { recorded: '기록 있음', empty: '빈 서고', unused: '미사용', review: '형식 확인 필요', error: '읽기 실패' };
                badges.append(element('span', `ml-badge${entry.state === 'recorded' ? ' ml-badge-used' : ''}`, labels[entry.state]));
                body.append(title, badges);
                if (entry.hasStore) {
                    body.append(element('p', 'ml-counts', `요약 ${number(entry.counts.summaries)} · 기억 ${number(entry.counts.memories)} · 기록한 턴 ${number(entry.counts.turns)}`));
                    const extra = [];
                    if (entry.counts.characters) extra.push(`인물 ${number(entry.counts.characters)}`);
                    if (entry.counts.checkpoints) extra.push(`복구 지점 ${number(entry.counts.checkpoints)}`);
                    if (extra.length) body.append(element('small', '', extra.join(' · ')));
                }
                const date = dateLabel(entry.updatedAt);
                if (date) body.append(element('small', '', `최근 대화 ${date}`));
                if (entry.error) body.append(element('small', 'ml-row-error', entry.error));
                const button = element('button', 'ml-single-backup', 'JSON 백업'); button.type = 'button'; button.disabled = !!busy || !entry.hasStore;
                button.setAttribute('aria-label', `${entry.ownerName} · ${entry.chatId} JSON 백업`);
                button.addEventListener('click', () => backup([entry], true));
                row.append(check, body, button); group.append(row);
            }
            renderSelection();
        }

        function render() {
            const totals = snapshot ? libraryTotals(snapshot.entries) : null;
            for (const node of root.querySelectorAll('[data-stat]')) node.textContent = totals ? number(totals[node.dataset.stat]) : '—';
            ui('results').hidden = !snapshot;
            ui('empty').hidden = !!snapshot;
            action('scan').disabled = !!busy;
            action('scan').hidden = busy === 'scan';
            action('scan').textContent = snapshot ? '다시 검사' : '전체 검사';
            action('stop').hidden = !busy;
            ui('progress').hidden = busy !== 'scan';
            if (busy === 'scan') {
                const done = snapshot?.ownersDone || 0, total = snapshot?.ownersTotal || 0;
                ui('progress').max = total || 1; ui('progress').value = done;
                ui('scan-title').textContent = '서고를 찾고 있어요';
                ui('scan-detail').textContent = total ? `봇·그룹 ${number(done)} / ${number(total)} · 채팅 ${number(snapshot.chatsDone)}개 확인` : '봇과 그룹 목록을 확인하고 있습니다…';
            } else if (snapshot) {
                const names = { complete: '전체 검사 완료', partial: '일부 항목을 확인하지 못했어요', cancelled: '검사를 중단했어요' };
                ui('scan-title').textContent = `${cached ? '지난 검사 결과 · ' : ''}${names[snapshot.phase] || '검사 중'}`;
                ui('scan-detail').textContent = `${dateLabel(snapshot.at)} · 채팅 ${number(snapshot.chatsDone)}개 확인${snapshot.phase !== 'complete' ? ' · 아직 확인하지 못한 채팅이 있을 수 있어요.' : ''}`;
            }
            renderList(); renderErrors();
        }

        async function scan() {
            if (busy) return;
            busy = 'scan'; cached = false; page = 0; selected.clear(); backupErrors = []; controller = new AbortController();
            snapshot = null; message(''); render();
            try {
                const result = await scanLibrary({ characters: getContext().characters || [], post, signal: controller.signal, live, liveTarget: getLiveTarget(),
                    onProgress: value => { if (!disposed) { snapshot = value; render(); } } });
                if (disposed) return;
                snapshot = result;
                try {
                    const raw = JSON.stringify(result);
                    if (raw.length <= 2_000_000) storage?.setItem(CACHE_KEY, raw);
                    else storage?.removeItem(CACHE_KEY);
                } catch { /* A full storage quota must not hide the current results. */ }
                message('');
            } catch (error) { if (!disposed) message(error.message); }
            finally { busy = ''; if (!disposed) render(); }
        }

        async function backup(entries, single = false) {
            if (busy) return;
            busy = 'backup'; backupErrors = []; controller = new AbortController(); message('최신 기록을 읽어 백업 파일을 준비합니다…'); render();
            try {
                if (single) {
                    const payload = await readLibraryExport(entries[0], { post, live, signal: controller.signal });
                    if (disposed || controller.signal.aborted) return;
                    download(JSON.stringify(payload, null, 2), backupFilename(entries[0]), 'application/json');
                    message('JSON 다운로드를 요청했습니다. 기기의 다운로드 목록에서 파일을 확인해 주세요.');
                } else {
                    const result = await buildLibraryBackup(entries, { post, live, signal: controller.signal, scanIncomplete: snapshot?.phase !== 'complete',
                        onProgress: p => { if (!disposed) message(`백업 준비 ${number(p.done)} / ${number(p.total)} · 성공 ${number(p.successes)} · 실패 ${number(p.failures)}`); } });
                    if (disposed || controller.signal.aborted) return;
                    backupErrors = result.failures;
                    if (result.blob) {
                        download(result.blob, `Memoria_서고백업_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`, 'application/zip');
                        message(`${number(result.successes.length)}개 채팅의 ZIP 다운로드를 요청했습니다.${result.failures.length ? ` ${number(result.failures.length)}개는 백업하지 못했습니다. 실패 내역을 확인해 주세요.` : ' 기기의 다운로드 목록에서 파일을 확인해 주세요.'}`);
                    } else message('백업한 채팅이 없습니다. 실패 내역을 확인해 주세요.');
                }
            } catch (error) { if (!disposed) message(controller.signal.aborted ? '백업 준비를 중단했습니다. 파일은 내려받지 않았습니다.' : error.message); }
            finally { busy = ''; if (!disposed) render(); }
        }

        action('scan').addEventListener('click', scan);
        action('stop').addEventListener('click', () => controller?.abort());
        for (const key of ['search', 'filter', 'sort']) ui(key).addEventListener(key === 'search' ? 'input' : 'change', () => { page = 0; renderList(); });
        action('select').addEventListener('click', () => { for (const e of filtered()) if (e.hasStore) selected.add(e.key); renderList(); });
        action('clear').addEventListener('click', () => { selected.clear(); renderList(); });
        const movePage = delta => {
            page += delta; renderList();
            ui('list').style.scrollMarginTop = `${root.querySelector('.ml-backup-bar').offsetHeight + 16}px`;
            ui('list').scrollIntoView({ block: 'start' });
        };
        action('prev').addEventListener('click', () => movePage(-1));
        action('next').addEventListener('click', () => movePage(1));
        action('backup').addEventListener('click', () => backup(snapshot.entries.filter(e => selected.has(e.key))));
        render();
        const context = getContext();
        // SillyTavern clips popup content by default; the body must opt into vertical scrolling.
        await context.callGenericPopup($root, context.POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true, okButton: '닫기' });
    } finally {
        disposed = true; controller?.abort(); opened = false;
    }
}
