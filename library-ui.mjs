import { createLibraryPost, scanLibrary, filterLibrary, libraryTotals, ownerKey, libraryKey, readLibraryExport, backupFilename, buildLibraryBackup } from './library-engine.mjs';
import { groupLibrary, libraryPage, selectionState, chatLabel, ownerAvatarSources } from './library-view.mjs';

const CACHE_KEY = 'memoria.libraryIndex.v1';
const OWNER_PAGE_SIZE = 8;
const CHAT_PAGE_SIZE = 10;
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
        const selected = new Set();
        let activeOwner = null, overviewState = null, selectionControls = [];
        let backupErrors = [];
        const options = () => ({ query: ui('search').value, filter: ui('filter').value, sort: ui('sort').value });
        const ownerEntries = () => (snapshot?.entries || []).filter(e => ownerKey(e) === activeOwner?.key);
        const filtered = () => filterLibrary(activeOwner ? ownerEntries() : snapshot?.entries || [], options());
        const message = text => { ui('message').textContent = text; ui('message').hidden = !text; };
        const element = (tag, className, text) => {
            const node = document.createElement(tag);
            if (className) node.className = className;
            if (text !== undefined) node.textContent = text;
            return node;
        };

        function avatar(owner) {
            const box = element('span', 'ml-portrait'); box.setAttribute('aria-hidden', 'true');
            const fallback = element('span', 'ml-portrait-fallback', owner.kind === 'group' ? '◈' : [...owner.ownerName][0] || 'M');
            box.append(fallback);
            const sources = ownerAvatarSources(owner, getContext());
            const photos = element('span', sources.length > 1 ? 'ml-photos is-collage' : 'ml-photos');
            for (const source of sources) {
                const img = element('img'); img.alt = ''; img.loading = 'lazy'; img.decoding = 'async';
                img.addEventListener('load', () => { fallback.hidden = true; }, { once: true });
                img.addEventListener('error', () => {
                    img.remove(); photos.classList.toggle('is-collage', photos.childElementCount > 1);
                    if (!photos.childElementCount) fallback.hidden = false;
                }, { once: true });
                img.src = source; photos.append(img);
            }
            box.append(photos); return box;
        }

        function checkbox(entries, label, row) {
            const wrap = element('label', 'ml-check-wrap');
            const check = element('input', 'ml-check'); check.type = 'checkbox'; check.setAttribute('aria-label', label);
            wrap.append(check);
            selectionControls.push({ check, entries, row });
            check.addEventListener('change', () => {
                for (const key of selectionState(entries, selected).keys) {
                    if (check.checked) selected.add(key); else selected.delete(key);
                }
                renderSelection();
            });
            return wrap;
        }

        function enterOwner(owner) {
            overviewState = { ...options(), page };
            activeOwner = owner; page = 0;
            renderList(); ui('owner-detail').scrollIntoView({ block: 'start' });
            action('back').focus({ preventScroll: true });
        }

        function renderErrors() {
            const errors = [...(snapshot?.errors || []), ...backupErrors];
            ui('errors').hidden = !errors.length;
            ui('errors-title').textContent = `확인하지 못한 항목 ${number(errors.length)}개`;
            ui('errors-list').replaceChildren(...errors.map(e => element('li', '', `${e.ownerName || '검사'}${e.chatId ? ` · ${e.chatId}` : ''} — ${e.message}`)));
        }

        function renderSelection() {
            ui('selection').textContent = selected.size ? `총 ${number(selected.size)}개 선택` : '선택 없음';
            action('backup').textContent = selected.size ? `${number(selected.size)}개 백업` : '선택 백업';
            action('backup').disabled = !!busy || !selected.size;
            action('select').disabled = !!busy || !filtered().some(e => e.hasStore);
            action('clear').disabled = !!busy || !selected.size;
            action('backup-stop').hidden = busy !== 'backup';
            for (const { check, entries, row } of selectionControls) {
                const state = selectionState(entries, selected);
                check.checked = state.checked; check.indeterminate = state.mixed;
                check.setAttribute('aria-checked', state.mixed ? 'mixed' : String(state.checked));
                check.disabled = !!busy || !state.keys.length;
                row.classList.toggle('is-selected', state.count > 0);
            }
            if (activeOwner) {
                const count = ownerEntries().filter(e => e.hasStore).length;
                action('owner-backup').disabled = !!busy || !count;
                action('owner-backup').textContent = `이 ${activeOwner.kind === 'group' ? '그룹' : '봇'} 전체 백업 · ${number(count)}개`;
            }
        }

        function renderList() {
            const rows = filtered();
            const owners = activeOwner ? [] : groupLibrary(snapshot?.entries || [], options());
            const result = libraryPage(activeOwner ? rows : owners, page, activeOwner ? CHAT_PAGE_SIZE : OWNER_PAGE_SIZE);
            page = result.page;
            root.classList.toggle('is-detail', !!activeOwner);
            ui('owner-detail').hidden = !activeOwner;
            ui('search-label').textContent = activeOwner ? `이 ${activeOwner.kind === 'group' ? '그룹' : '봇'}의 채팅 찾기` : '봇·채팅 찾기';
            ui('search').placeholder = activeOwner ? '채팅 이름으로 검색' : '봇 이름 또는 채팅 이름';
            ui('matches').textContent = activeOwner ? `조건에 맞는 채팅 ${number(rows.length)}개` : `봇·그룹 ${number(owners.length)}개 · 채팅 ${number(rows.length)}개`;
            action('select').title = '현재 검색·표시 조건에 맞는 채팅을 모든 페이지에서 선택합니다.';
            ui('page').replaceChildren(...Array.from({ length: result.pages }, (_, i) => {
                const option = element('option', '', `${i + 1} / ${result.pages}`); option.value = String(i); return option;
            }));
            ui('page').value = String(page);
            action('prev').disabled = page === 0;
            action('next').disabled = page >= result.pages - 1;
            const list = ui('list');
            list.replaceChildren(); selectionControls = [];
            if (activeOwner) {
                const all = ownerEntries();
                const title = element('div', 'ml-detail-title');
                title.append(element('h3', '', activeOwner.ownerName), element('p', '', `전체 채팅 ${number(all.length)}개 · 요약 ${number(all.reduce((n, e) => n + e.counts.summaries, 0))}개`));
                ui('owner-heading').replaceChildren(avatar(activeOwner), title);
            }
            if (!rows.length) {
                const box = element('div', 'ml-empty');
                box.append(element('strong', '', busy === 'scan' ? '기록을 찾고 있어요' : '표시할 채팅이 없어요'), element('p', '', '검색어나 표시 조건을 바꿔 보세요. 빈 서고와 미사용 채팅은 기본 목록에서 제외됩니다.'));
                list.append(box);
            }
            if (!activeOwner) {
                const names = new Map();
                // Duplicate names stay distinguishable even when a search hides one of the bots.
                for (const owner of groupLibrary(snapshot?.entries || [], { filter: 'all' })) names.set(owner.ownerName, (names.get(owner.ownerName) || 0) + 1);
                for (const owner of result.items) {
                    const row = element('div', 'ml-owner-row');
                    const open = element('button', 'ml-owner-open'); open.type = 'button'; open.disabled = busy === 'scan';
                    open.dataset.ownerKey = owner.key;
                    open.setAttribute('aria-label', `${owner.ownerName} · ${owner.ownerId} 채팅 보기`);
                    const info = element('span', 'ml-owner-info');
                    info.append(element('strong', '', owner.ownerName), element('span', 'ml-owner-counts', `채팅 ${number(owner.entries.length)} · 요약 ${number(owner.summaries)} · 기억 ${number(owner.memories)}`));
                    if (owner.kind === 'group' || names.get(owner.ownerName) > 1) info.append(element('small', '', names.get(owner.ownerName) > 1 ? owner.ownerId : '그룹 채팅'));
                    open.append(avatar(owner), info, element('span', 'ml-chevron', '›'));
                    open.addEventListener('click', () => enterOwner(owner));
                    row.append(checkbox(owner.entries, `${owner.ownerName} · ${owner.ownerId}의 검색된 채팅 모두 선택`, row), open);
                    list.append(row);
                }
            } else for (const entry of result.items) {
                const row = element('div', 'ml-chat');
                const body = element('div', 'ml-chat-body');
                const detail = element('details', 'ml-chat-detail');
                const summary = element('summary');
                summary.append(element('strong', 'ml-chat-title', chatLabel(entry)));
                const labels = { empty: '빈 서고', unused: '미사용', review: '형식 확인 필요', error: '읽기 실패' };
                summary.append(element('span', 'ml-counts', entry.hasStore ? `요약 ${number(entry.counts.summaries)} · 기억 ${number(entry.counts.memories)}${entry.live ? ' · 현재 채팅' : ''}${labels[entry.state] ? ` · ${labels[entry.state]}` : ''}` : labels[entry.state]));
                detail.append(summary, element('p', 'ml-original-name', `원래 채팅 이름: ${entry.chatId}`));
                if (entry.hasStore) detail.append(element('p', '', `턴 기록 ${number(entry.counts.turns)} · 인물 ${number(entry.counts.characters)} · 복구 지점 ${number(entry.counts.checkpoints)}`));
                const date = dateLabel(entry.updatedAt);
                if (date) detail.append(element('p', '', `최근 대화 ${date}`));
                if (labels[entry.state]) detail.append(element('p', '', labels[entry.state]));
                if (entry.error) detail.append(element('p', 'ml-row-error', entry.error));
                const button = element('button', 'ml-single-backup', '이 채팅 JSON 백업'); button.type = 'button'; button.disabled = !!busy || !entry.hasStore;
                button.setAttribute('aria-label', `${entry.ownerName} · ${entry.chatId} JSON 백업`);
                button.addEventListener('click', () => backup([entry], true));
                detail.append(button); body.append(detail);
                row.append(checkbox([entry], `${entry.ownerName} · ${entry.chatId} 선택`, row), body); list.append(row);
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
            busy = 'scan'; cached = false; page = 0; activeOwner = null; overviewState = null; selected.clear(); backupErrors = []; controller = new AbortController();
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
            ui('message').scrollIntoView({ block: 'nearest' });
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
        action('backup-stop').addEventListener('click', () => controller?.abort());
        action('back').addEventListener('click', () => {
            const previous = activeOwner?.key;
            activeOwner = null;
            if (overviewState) {
                ui('search').value = overviewState.query; ui('filter').value = overviewState.filter; ui('sort').value = overviewState.sort; page = overviewState.page;
            }
            renderList(); ui('results').scrollIntoView({ block: 'start' });
            const focus = [...root.querySelectorAll('.ml-owner-open')].find(button => button.dataset.ownerKey === previous) || action('select');
            focus.focus({ preventScroll: true });
        });
        action('owner-backup').addEventListener('click', () => backup(ownerEntries().filter(e => e.hasStore)));
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
        ui('page').addEventListener('change', () => movePage(Number(ui('page').value) - page));
        action('backup').addEventListener('click', () => backup(snapshot.entries.filter(e => selected.has(e.key))));
        render();
        const context = getContext();
        // SillyTavern clips popup content by default; the body must opt into vertical scrolling.
        await context.callGenericPopup($root, context.POPUP_TYPE.TEXT, '', { wide: true, allowVerticalScrolling: true, okButton: '닫기' });
    } finally {
        disposed = true; controller?.abort(); opened = false;
    }
}
