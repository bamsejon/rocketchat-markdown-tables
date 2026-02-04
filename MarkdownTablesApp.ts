import {
    IAppAccessors,
    ILogger,
    IHttp,
    IMessageBuilder,
    IPersistence,
    IRead,
    IConfigurationExtend,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { IMessage, IPreMessageSentModify } from '@rocket.chat/apps-engine/definition/messages';
import { ISetting, SettingType } from '@rocket.chat/apps-engine/definition/settings';

import { parseMarkdownTable, TableData, convertTsvToMarkdown } from './lib/tableParser';
import { TablePrefsCommand, UserTablePrefs } from './commands/TablePrefsCommand';

// Box-drawing character sets
const UNICODE_CHARS = {
    topLeft: '┌', topRight: '┐', bottomLeft: '└', bottomRight: '┘',
    horizontal: '─', vertical: '│',
    teeDown: '┬', teeUp: '┴', teeRight: '├', teeLeft: '┤', cross: '┼',
};

const ASCII_CHARS = {
    topLeft: '+', topRight: '+', bottomLeft: '+', bottomRight: '+',
    horizontal: '-', vertical: '|',
    teeDown: '+', teeUp: '+', teeRight: '+', teeLeft: '+', cross: '+',
};

export class MarkdownTablesApp extends App implements IPreMessageSentModify {
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    public async extendConfiguration(configuration: IConfigurationExtend): Promise<void> {
        // Register slash command for user preferences
        await configuration.slashCommands.provideSlashCommand(new TablePrefsCommand());

        await configuration.settings.provideSetting({
            id: 'table_style',
            type: SettingType.SELECT,
            packageValue: 'unicode',
            required: false,
            public: false,
            i18nLabel: 'Table Style',
            i18nDescription: 'Choose how tables are displayed',
            values: [
                { key: 'unicode', i18nLabel: 'Unicode (box-drawing)' },
                { key: 'ascii', i18nLabel: 'ASCII (+, -, |)' },
                { key: 'cards', i18nLabel: 'Cards (mobile-friendly)' },
            ],
        });

        await configuration.settings.provideSetting({
            id: 'show_links_below',
            type: SettingType.BOOLEAN,
            packageValue: true,
            required: false,
            public: false,
            i18nLabel: 'Show links below table',
            i18nDescription: 'Extract links from table cells and display them as clickable links below the table',
        });

        await configuration.settings.provideSetting({
            id: 'disable_link_previews',
            type: SettingType.BOOLEAN,
            packageValue: true,
            required: false,
            public: false,
            i18nLabel: 'Disable link previews',
            i18nDescription: 'Disable automatic link previews for messages containing tables',
        });

        await configuration.settings.provideSetting({
            id: 'default_show_links_below',
            type: SettingType.BOOLEAN,
            packageValue: true,
            required: false,
            public: false,
            i18nLabel: 'Default: Show links below table',
            i18nDescription: 'Default setting for new users - whether to show links below table images. Users can override with /tableprefs command.',
        });

        await configuration.settings.provideSetting({
            id: 'default_language',
            type: SettingType.SELECT,
            packageValue: 'auto',
            required: false,
            public: false,
            i18nLabel: 'Help text language',
            i18nDescription: 'Language for help text below tables. "Auto" tries to detect from user/server settings.',
            values: [
                { key: 'auto', i18nLabel: 'Auto-detect' },
                { key: 'sv', i18nLabel: 'Svenska' },
                { key: 'en', i18nLabel: 'English' },
                { key: 'de', i18nLabel: 'Deutsch' },
                { key: 'fr', i18nLabel: 'Français' },
                { key: 'es', i18nLabel: 'Español' },
                { key: 'pt', i18nLabel: 'Português' },
                { key: 'nl', i18nLabel: 'Nederlands' },
                { key: 'it', i18nLabel: 'Italiano' },
                { key: 'ru', i18nLabel: 'Русский' },
                { key: 'ja', i18nLabel: '日本語' },
                { key: 'zh', i18nLabel: '中文' },
            ],
        });
    }

    public async checkPreMessageSentModify(
        message: IMessage,
        read: IRead,
        http: IHttp
    ): Promise<boolean> {
        if (!message.text) {
            return false;
        }
        // Check for markdown tables (pipes) or TSV data (tabs)
        const hasMarkdownTable = message.text.includes('|') && message.text.includes('\n');
        const hasTsvData = message.text.includes('\t') && message.text.includes('\n');
        return hasMarkdownTable || hasTsvData;
    }

    public async executePreMessageSentModify(
        message: IMessage,
        builder: IMessageBuilder,
        read: IRead,
        http: IHttp,
        persistence: IPersistence
    ): Promise<IMessage> {
        if (!message.text) {
            return message;
        }

        // First, convert any TSV data (e.g., pasted from Excel) to markdown format
        let processedText = message.text;
        if (message.text.includes('\t')) {
            processedText = convertTsvToMarkdown(message.text);
        }

        const tables = parseMarkdownTable(processedText);

        if (tables.length === 0) {
            return message;
        }

        // Get settings
        const tableStyle = await read.getEnvironmentReader().getSettings().getValueById('table_style');
        const showLinksBelow = await read.getEnvironmentReader().getSettings().getValueById('show_links_below');
        const disableLinkPreviews = await read.getEnvironmentReader().getSettings().getValueById('disable_link_previews');

        // Disable link previews if setting is enabled
        if (disableLinkPreviews !== false) {
            builder.setParseUrls(false);
        }

        // Handle cards (mobile-friendly) mode with SVG image
        if (tableStyle === 'cards') {
            // Get default setting and user preferences
            const defaultShowLinks = await read.getEnvironmentReader().getSettings().getValueById('default_show_links_below');
            const userPrefs = await this.getUserPrefs(read, message.sender.id, defaultShowLinks !== false);

            // Get language for help text
            const langSetting = await read.getEnvironmentReader().getSettings().getValueById('default_language');
            let userLang = 'en';

            if (langSetting && langSetting !== 'auto') {
                // Use admin-configured language
                userLang = langSetting as string;
            } else {
                // Auto-detect: try user settings, then server settings
                if (message.sender.settings?.preferences?.language) {
                    userLang = message.sender.settings.preferences.language;
                } else {
                    try {
                        const serverLang = await read.getEnvironmentReader().getServerSettings().getValueById('Language');
                        if (serverLang && typeof serverLang === 'string') {
                            userLang = serverLang;
                        }
                    } catch (e) {
                        // Ignore errors, use default
                    }
                }
            }

            let modifiedText = processedText;

            for (const table of tables) {
                // Generate card text with inline image
                const cardText = this.createCardText(table, userPrefs.showLinksBelow, userLang);
                modifiedText = modifiedText.replace(table.rawText, cardText);
            }

            modifiedText = modifiedText.replace(/\n{3,}/g, '\n\n').trim();
            builder.setText(modifiedText);

            return builder.getMessage();
        }

        // ASCII/Unicode mode
        const chars = tableStyle === 'ascii' ? ASCII_CHARS : UNICODE_CHARS;
        let modifiedText = processedText;

        for (const table of tables) {
            const formattedTable = this.createFormattedTable(table, chars, showLinksBelow !== false);
            modifiedText = modifiedText.replace(table.rawText, formattedTable);
        }

        modifiedText = modifiedText.replace(/\n{3,}/g, '\n\n').trim();

        builder.setText(modifiedText);

        return builder.getMessage();
    }

    private async getUserPrefs(read: IRead, userId: string, defaultShowLinks: boolean = true): Promise<UserTablePrefs> {
        const association = TablePrefsCommand.getUserAssociation(userId);
        const records = await read.getPersistenceReader().readByAssociation(association);

        if (records && records.length > 0) {
            return records[0] as UserTablePrefs;
        }

        // Default preferences from app settings
        return {
            showLinksBelow: defaultShowLinks,
        };
    }

    // Normalize URL for deduplication (removes protocol, www, trailing slash)
    private normalizeUrlForCompare(url: string): string {
        return url.toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/^www\./, '')
            .replace(/\/+$/, '');
    }

    private createCardText(table: TableData, showLinksBelow: boolean = true, userLang: string = 'en'): string {
        // Collect all links from the table before stripping markdown
        const links: { text: string; url: string }[] = [];

        // Helper to check if URL already exists (normalized comparison)
        const urlExists = (url: string): boolean => {
            const normalized = this.normalizeUrlForCompare(url);
            return links.some(l => this.normalizeUrlForCompare(l.url) === normalized);
        };

        for (const row of table.rows) {
            for (const cell of row) {
                if (cell) {
                    // Check for plain URLs (must have protocol)
                    const urlRegex = /https?:\/\/[^\s\]\)]+/g;
                    let urlMatch;
                    while ((urlMatch = urlRegex.exec(cell)) !== null) {
                        const url = urlMatch[0];
                        if (!urlExists(url)) {
                            try {
                                const hostname = new URL(url).hostname.replace(/^www\./, '');
                                links.push({ text: hostname, url: url });
                            } catch {
                                links.push({ text: url, url: url });
                            }
                        }
                    }
                    // Check for markdown links
                    const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
                    let match;
                    while ((match = mdLinkRegex.exec(cell)) !== null) {
                        const linkUrl = match[2];
                        // Skip anchor-only links like # or #section
                        if (linkUrl.startsWith('#') || linkUrl === '') {
                            continue;
                        }
                        if (!urlExists(linkUrl)) {
                            links.push({ text: match[1], url: linkUrl });
                        }
                    }
                }
            }
        }

        // Parse headers and rows - keep formatting info for SVG rendering
        const parsedHeaders = table.headers.map(h => this.parseFormattedText(h));
        const parsedRows = table.rows.map(row => row.map(cell => this.parseFormattedText(cell || '')));

        // Get plain text for width calculation
        const plainHeaders = parsedHeaders.map(segments => segments.map(s => s.text).join(''));
        const plainRows = parsedRows.map(row => row.map(segments => segments.map(s => s.text).join('')));

        // Generate compact SVG table
        const pad = 10;
        const fs = 14;
        const rh = fs + pad * 2 + 4; // row height

        // Calculate column widths based on plain text content
        const cw: number[] = []; // column widths
        for (let i = 0; i < plainHeaders.length; i++) {
            let maxLen = plainHeaders[i].length;
            for (const row of plainRows) {
                const cellLen = (row[i] || '').length;
                if (cellLen > maxLen) maxLen = cellLen;
            }
            cw.push(Math.max(maxLen * 9 + pad * 2, 80));
        }

        const tw = cw.reduce((a, b) => a + b, 0); // total width
        const th = rh * (parsedRows.length + 1); // total height

        // Compact SVG with CSS classes for reuse (shorter than inline styles)
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th}">`;
        svg += `<style>.h{fill:#D00;stroke:#333}.c{fill:#FFF;stroke:#333}.t{font:${fs}px Arial}.w{fill:#FFF;font-weight:700}.b{fill:#000}</style>`;

        let y = 0;

        // Header row
        let x = 0;
        for (let col = 0; col < parsedHeaders.length; col++) {
            const al = table.alignments[col] || 'left';
            svg += `<rect class="h" x="${x}" y="0" width="${cw[col]}" height="${rh}"/>`;
            const txtW = plainHeaders[col].length * fs * 0.55;
            let tx = al === 'center' ? Math.round(x + (cw[col] - txtW) / 2) :
                     al === 'right' ? Math.round(x + cw[col] - pad - txtW) : x + pad;
            const ty = Math.round(rh / 2 + fs / 3);
            svg += `<text class="t w" x="${tx}" y="${ty}">${this.escapeXml(plainHeaders[col])}</text>`;
            x += cw[col];
        }
        y = rh;

        // Data rows
        for (let ri = 0; ri < parsedRows.length; ri++) {
            x = 0;
            for (let col = 0; col < parsedHeaders.length; col++) {
                const segs = parsedRows[ri][col] || [];
                const al = table.alignments[col] || 'left';
                svg += `<rect class="c" x="${x}" y="${y}" width="${cw[col]}" height="${rh}"/>`;
                svg += this.renderFormattedTextCompact(segs, x, Math.round(y + rh / 2 + fs / 3), cw[col], pad, al, fs);
                x += cw[col];
            }
            y += rh;
        }

        svg += '</svg>';

        // Create data URL for the SVG
        const base64 = Buffer.from(svg).toString('base64');
        const imageDataUrl = `data:image/svg+xml;base64,${base64}`;
        let result = '';

        // Add links BEFORE the image
        if (links.length > 0 && showLinksBelow) {
            // Deduplicate using normalized URL comparison
            const uniqueLinks = links.filter((link, index, self) =>
                index === self.findIndex(l =>
                    this.normalizeUrlForCompare(l.url) === this.normalizeUrlForCompare(link.url)
                )
            );
            result += '**Länkar i tabellen:**';
            for (const link of uniqueLinks) {
                result += `\n- [${link.text}](${link.url})`;
            }
            result += '\n\n';

            // Add help text about the tableprefs command
            const helpText = this.getHelpText(userLang, showLinksBelow);
            result += `_${helpText}_\n\n`;
        }

        // Use inline image - Rocket.Chat doesn't support nested [![img](url)](link) syntax
        // The data URL click popup is unfortunate but unavoidable without proper RC support
        result += `![Table](${imageDataUrl})`;

        return result;
    }

    private getHelpText(lang: string, showLinksBelow: boolean): string {
        const texts: { [key: string]: { on: string; off: string } } = {
            sv: {
                on: 'Använd /tableprefs links off för att dölja länkarna under tabellen',
                off: 'Använd /tableprefs links on för att visa länkarna under tabellen',
            },
            en: {
                on: 'Use /tableprefs links off to hide links below the table',
                off: 'Use /tableprefs links on to show links below the table',
            },
            de: {
                on: 'Verwenden Sie /tableprefs links off um Links unter der Tabelle auszublenden',
                off: 'Verwenden Sie /tableprefs links on um Links unter der Tabelle anzuzeigen',
            },
            fr: {
                on: 'Utilisez /tableprefs links off pour masquer les liens sous le tableau',
                off: 'Utilisez /tableprefs links on pour afficher les liens sous le tableau',
            },
            es: {
                on: 'Usa /tableprefs links off para ocultar los enlaces debajo de la tabla',
                off: 'Usa /tableprefs links on para mostrar los enlaces debajo de la tabla',
            },
            pt: {
                on: 'Use /tableprefs links off para ocultar os links abaixo da tabela',
                off: 'Use /tableprefs links on para mostrar os links abaixo da tabela',
            },
            nl: {
                on: 'Gebruik /tableprefs links off om links onder de tabel te verbergen',
                off: 'Gebruik /tableprefs links on om links onder de tabel te tonen',
            },
            it: {
                on: 'Usa /tableprefs links off per nascondere i link sotto la tabella',
                off: 'Usa /tableprefs links on per mostrare i link sotto la tabella',
            },
            ru: {
                on: 'Используйте /tableprefs links off чтобы скрыть ссылки под таблицей',
                off: 'Используйте /tableprefs links on чтобы показать ссылки под таблицей',
            },
            ja: {
                on: '/tableprefs links off でテーブル下のリンクを非表示にできます',
                off: '/tableprefs links on でテーブル下にリンクを表示できます',
            },
            zh: {
                on: '使用 /tableprefs links off 隐藏表格下方的链接',
                off: '使用 /tableprefs links on 显示表格下方的链接',
            },
        };

        // Get the base language (e.g., 'sv' from 'sv-SE')
        const baseLang = lang.split('-')[0].toLowerCase();

        const langTexts = texts[baseLang] || texts['en'];
        return showLinksBelow ? langTexts.on : langTexts.off;
    }

    private escapeXml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    // Text segment with formatting info
    private parseFormattedText(text: string): Array<{ text: string; bold: boolean; italic: boolean; code: boolean }> {
        const segments: Array<{ text: string; bold: boolean; italic: boolean; code: boolean }> = [];

        // First, handle markdown links [text](url) -> text
        let processed = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

        // Regex to find formatted sections
        // Match: **bold**, *italic*, `code`, __bold__, _italic_
        const formatRegex = /(\*\*(.+?)\*\*|__(.+?)__|(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)|`([^`]+)`)/g;

        let lastIndex = 0;
        let match;

        while ((match = formatRegex.exec(processed)) !== null) {
            // Add any text before this match as plain
            if (match.index > lastIndex) {
                segments.push({
                    text: processed.slice(lastIndex, match.index),
                    bold: false,
                    italic: false,
                    code: false,
                });
            }

            // Determine what kind of formatting this is
            if (match[2] !== undefined) {
                // **bold**
                segments.push({ text: match[2], bold: true, italic: false, code: false });
            } else if (match[3] !== undefined) {
                // __bold__
                segments.push({ text: match[3], bold: true, italic: false, code: false });
            } else if (match[4] !== undefined) {
                // *italic*
                segments.push({ text: match[4], bold: false, italic: true, code: false });
            } else if (match[5] !== undefined) {
                // _italic_
                segments.push({ text: match[5], bold: false, italic: true, code: false });
            } else if (match[6] !== undefined) {
                // `code`
                segments.push({ text: match[6], bold: false, italic: false, code: true });
            }

            lastIndex = match.index + match[0].length;
        }

        // Add remaining text
        if (lastIndex < processed.length) {
            segments.push({
                text: processed.slice(lastIndex),
                bold: false,
                italic: false,
                code: false,
            });
        }

        // If no segments, return the whole text as plain
        if (segments.length === 0) {
            segments.push({ text: processed, bold: false, italic: false, code: false });
        }

        return segments;
    }

    // Render formatted text segments as SVG with alignment support
    private renderFormattedText(
        segments: Array<{ text: string; bold: boolean; italic: boolean; code: boolean }>,
        cellX: number,
        y: number,
        color: string,
        fontSize: number,
        cellWidth?: number,
        cellPadding?: number,
        alignment?: string
    ): string {
        let svg = '';
        const padding = cellPadding || 10;
        const align = alignment || 'left';

        // Calculate total text width for alignment
        let totalTextWidth = 0;
        for (const segment of segments) {
            const charWidth = segment.code ? fontSize * 0.6 : fontSize * 0.55;
            totalTextWidth += segment.text.length * charWidth;
        }

        // Calculate starting X position based on alignment
        let startX: number;
        if (cellWidth && align === 'center') {
            startX = cellX + (cellWidth - totalTextWidth) / 2;
        } else if (cellWidth && align === 'right') {
            startX = cellX + cellWidth - padding - totalTextWidth;
        } else {
            startX = cellX + padding;
        }

        let currentX = startX;

        for (const segment of segments) {
            const attrs: string[] = [`x="${currentX}"`, `y="${y}"`, `fill="${color}"`];

            if (segment.bold) {
                attrs.push('font-weight="bold"');
            }
            if (segment.italic) {
                attrs.push('font-style="italic"');
            }
            if (segment.code) {
                attrs.push('font-family="monospace"');
            }

            svg += `<text ${attrs.join(' ')}>${this.escapeXml(segment.text)}</text>`;

            // Approximate width for positioning next segment
            const charWidth = segment.code ? fontSize * 0.6 : fontSize * 0.55;
            currentX += segment.text.length * charWidth;
        }

        return svg;
    }

    // Compact version that uses CSS classes for smaller output
    private renderFormattedTextCompact(
        segments: Array<{ text: string; bold: boolean; italic: boolean; code: boolean }>,
        cellX: number,
        y: number,
        cellWidth: number,
        cellPadding: number,
        alignment: string,
        fontSize: number
    ): string {
        let svg = '';

        // Calculate total text width for alignment
        let totalW = 0;
        for (const s of segments) {
            totalW += s.text.length * (s.code ? fontSize * 0.6 : fontSize * 0.55);
        }

        // Starting X based on alignment
        let sx = alignment === 'center' ? Math.round(cellX + (cellWidth - totalW) / 2) :
                 alignment === 'right' ? Math.round(cellX + cellWidth - cellPadding - totalW) :
                 cellX + cellPadding;

        for (const s of segments) {
            // Use short class names: b=black fill, t=font
            let cls = 't b';
            if (s.bold) cls += ' font-weight:700';
            if (s.italic) cls += ' font-style:italic';
            if (s.code) cls += ' font-family:monospace';

            // Only add extra attributes if needed
            const extra = s.bold ? ' font-weight="700"' : '';
            const extra2 = s.italic ? ' font-style="italic"' : '';
            const extra3 = s.code ? ' font-family="monospace"' : '';

            svg += `<text class="t b" x="${sx}" y="${y}"${extra}${extra2}${extra3}>${this.escapeXml(s.text)}</text>`;
            sx += Math.round(s.text.length * (s.code ? fontSize * 0.6 : fontSize * 0.55));
        }

        return svg;
    }

    private stripMarkdown(text: string): string {
        return text
            // Remove markdown links [text](url) -> text
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            // Remove bold **text** or __text__ -> text
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/__([^_]+)__/g, '$1')
            // Remove italic *text* or _text_ -> text (but not inside words)
            .replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1')
            .replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1')
            // Remove strikethrough ~~text~~ -> text
            .replace(/~~([^~]+)~~/g, '$1')
            // Remove inline code `text` -> text
            .replace(/`([^`]+)`/g, '$1');
    }

    private createFormattedTable(table: TableData, chars: typeof UNICODE_CHARS, showLinksBelow: boolean): string {
        // Extract all links from the table for display after the code block
        const links: { text: string; url: string }[] = [];
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        const plainUrlRegex = /https?:\/\/[^\s]+/g;

        // Helper to check if URL already exists (normalized comparison)
        const urlExists = (url: string): boolean => {
            const normalized = this.normalizeUrlForCompare(url);
            return links.some(l => this.normalizeUrlForCompare(l.url) === normalized);
        };

        // Function to extract links and replace with just the text
        const extractLinks = (text: string): string => {
            // First extract markdown links
            let result = text.replace(markdownLinkRegex, (match, linkText, url) => {
                if (!urlExists(url)) {
                    links.push({ text: linkText, url });
                }
                return linkText;
            });

            // Then extract plain URLs
            result = result.replace(plainUrlRegex, (url) => {
                // Don't add if already added (using normalized comparison)
                if (!urlExists(url)) {
                    // Use domain as display text for plain URLs
                    try {
                        const domain = new URL(url).hostname.replace(/^www\./, '');
                        links.push({ text: domain, url });
                    } catch {
                        links.push({ text: url, url });
                    }
                }
                return url;
            });

            return result;
        };

        // Process headers and rows to extract links
        const processedHeaders = table.headers.map(h => extractLinks(h));
        const processedRows = table.rows.map(row => row.map(cell => extractLinks(cell || '')));

        // Calculate column widths using display width (accounting for emojis)
        const colWidths: number[] = [];
        for (let i = 0; i < processedHeaders.length; i++) {
            let maxWidth = this.getDisplayWidth(processedHeaders[i]);
            for (const row of processedRows) {
                const cellWidth = this.getDisplayWidth(row[i] || '');
                if (cellWidth > maxWidth) {
                    maxWidth = cellWidth;
                }
            }
            colWidths.push(maxWidth);
        }

        const lines: string[] = [];

        // Build separator line
        const separatorParts = colWidths.map(w => chars.horizontal.repeat(w + 2));
        const topBorder = chars.topLeft + separatorParts.join(chars.teeDown) + chars.topRight;
        const headerSeparator = chars.teeRight + separatorParts.join(chars.cross) + chars.teeLeft;
        const bottomBorder = chars.bottomLeft + separatorParts.join(chars.teeUp) + chars.bottomRight;

        // Header row
        const headerCells = processedHeaders.map((h, i) => {
            return ' ' + this.padCell(h, colWidths[i], table.alignments[i]) + ' ';
        });
        const headerLine = chars.vertical + headerCells.join(chars.vertical) + chars.vertical;

        lines.push('```');
        lines.push(topBorder);
        lines.push(headerLine);
        lines.push(headerSeparator);

        // Data rows - clean and simple with solid vertical lines
        for (const row of processedRows) {
            const cells = row.map((cell, i) => {
                return ' ' + this.padCell(cell || '', colWidths[i], table.alignments[i]) + ' ';
            });
            lines.push(chars.vertical + cells.join(chars.vertical) + chars.vertical);
        }

        lines.push(bottomBorder);
        lines.push('```');

        // Add extracted links below the table if setting is enabled and links were found
        if (showLinksBelow && links.length > 0) {
            lines.push('');
            // Remove duplicates using normalized URL comparison
            const uniqueLinks = links.filter((link, index, self) =>
                index === self.findIndex(l =>
                    this.normalizeUrlForCompare(l.url) === this.normalizeUrlForCompare(link.url)
                )
            );
            for (const link of uniqueLinks) {
                lines.push(`🔗 [${link.text}](${link.url})`);
            }
        }

        return lines.join('\n');
    }

    // Calculate display width accounting for emojis (which typically render as 2 chars wide)
    private getDisplayWidth(text: string): number {
        // Match emojis - they typically display as 2 characters wide in monospace
        const emojiRegex = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2300}-\u{23FF}]|[\u{2B50}]|[\u{2705}]|[\u{274C}]|[\u{274E}]|[\u{2714}]|[\u{2716}]/gu;

        let width = 0;
        let lastIndex = 0;
        let match;

        while ((match = emojiRegex.exec(text)) !== null) {
            // Add width of text before this emoji
            width += match.index - lastIndex;
            // Emojis display as 2 characters wide
            width += 2;
            lastIndex = match.index + match[0].length;
        }

        // Add remaining text after last emoji
        width += text.length - lastIndex;

        return width;
    }

    private padCell(text: string, targetWidth: number, align: string): string {
        return this.padCellWithChar(text, targetWidth, align, ' ');
    }

    private padCellWithChar(text: string, targetWidth: number, align: string, padChar: string): string {
        const currentWidth = this.getDisplayWidth(text);
        const padding = targetWidth - currentWidth;
        if (padding <= 0) return text;

        if (align === 'center') {
            const left = Math.floor(padding / 2);
            const right = padding - left;
            return padChar.repeat(left) + text + padChar.repeat(right);
        } else if (align === 'right') {
            return padChar.repeat(padding) + text;
        } else {
            return text + padChar.repeat(padding);
        }
    }
}
