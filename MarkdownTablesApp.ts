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
                // Replace table with SVG image
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

    private createCardText(table: TableData, showLinksBelow: boolean = true, userLang: string = 'en'): string {
        // Generate SVG table
        const cellPadding = 10;
        const fontSize = 14;
        const headerBg = '#D70000';
        const cellBg = '#FFFFFF';
        const borderColor = '#333333';
        const textColor = '#000000';
        const headerTextColor = '#FFFFFF';

        // Calculate column widths based on content
        const colWidths: number[] = [];
        for (let i = 0; i < table.headers.length; i++) {
            let maxLen = table.headers[i].length;
            for (const row of table.rows) {
                const cellLen = (row[i] || '').length;
                if (cellLen > maxLen) maxLen = cellLen;
            }
            colWidths.push(Math.max(maxLen * 9 + cellPadding * 2, 80)); // ~9px per char
        }

        const rowHeight = fontSize + cellPadding * 2 + 4;
        const totalWidth = colWidths.reduce((a, b) => a + b, 0);
        const totalHeight = rowHeight * (table.rows.length + 1); // +1 for header

        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${totalHeight}">`;
        svg += `<style>text { font-family: Arial, sans-serif; font-size: ${fontSize}px; }</style>`;

        // Draw cells
        let y = 0;

        // Header row
        let x = 0;
        for (let col = 0; col < table.headers.length; col++) {
            svg += `<rect x="${x}" y="${y}" width="${colWidths[col]}" height="${rowHeight}" fill="${headerBg}" stroke="${borderColor}" stroke-width="1"/>`;
            svg += `<text x="${x + cellPadding}" y="${y + rowHeight / 2 + fontSize / 3}" fill="${headerTextColor}" font-weight="bold">${this.escapeXml(table.headers[col])}</text>`;
            x += colWidths[col];
        }
        y += rowHeight;

        // Data rows
        for (const row of table.rows) {
            x = 0;
            for (let col = 0; col < table.headers.length; col++) {
                const cellValue = row[col] || '';
                svg += `<rect x="${x}" y="${y}" width="${colWidths[col]}" height="${rowHeight}" fill="${cellBg}" stroke="${borderColor}" stroke-width="1"/>`;
                svg += `<text x="${x + cellPadding}" y="${y + rowHeight / 2 + fontSize / 3}" fill="${textColor}">${this.escapeXml(cellValue)}</text>`;
                x += colWidths[col];
            }
            y += rowHeight;
        }

        svg += '</svg>';

        // Collect all links from the table
        const links: { text: string; url: string }[] = [];
        for (const row of table.rows) {
            for (const cell of row) {
                if (cell) {
                    // Check for plain URLs
                    const urlMatch = cell.match(/^(https?:\/\/[^\s]+)$/);
                    if (urlMatch) {
                        try {
                            const domain = new URL(urlMatch[1]).hostname;
                            links.push({ text: domain, url: urlMatch[1] });
                        } catch {
                            links.push({ text: urlMatch[1], url: urlMatch[1] });
                        }
                    }
                    // Check for markdown links
                    const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
                    let match;
                    while ((match = mdLinkRegex.exec(cell)) !== null) {
                        links.push({ text: match[1], url: match[2] });
                    }
                }
            }
        }

        // Return as data URL that can be used in markdown
        const base64 = Buffer.from(svg).toString('base64');
        let result = `![Table](data:image/svg+xml;base64,${base64})`;

        // Add links below the image for mobile compatibility (if enabled)
        if (links.length > 0) {
            if (showLinksBelow) {
                const uniqueLinks = links.filter((link, index, self) =>
                    index === self.findIndex(l => l.url === link.url)
                );
                result += '\n';
                for (const link of uniqueLinks) {
                    result += `\n🔗 [${link.text}](${link.url})`;
                }
            }

            // Add help text about the tableprefs command
            const helpText = this.getHelpText(userLang, showLinksBelow);
            result += `\n\n_${helpText}_`;
        }

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

    private createFormattedTable(table: TableData, chars: typeof UNICODE_CHARS, showLinksBelow: boolean): string {
        // Extract all links from the table for display after the code block
        const links: { text: string; url: string }[] = [];
        const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        const plainUrlRegex = /(https?:\/\/[^\s]+)/g;

        // Function to extract links and replace with just the text
        const extractLinks = (text: string): string => {
            // First extract markdown links
            let result = text.replace(markdownLinkRegex, (match, linkText, url) => {
                links.push({ text: linkText, url });
                return linkText;
            });

            // Then extract plain URLs
            result = result.replace(plainUrlRegex, (url) => {
                // Don't add if already added as markdown link
                if (!links.some(l => l.url === url)) {
                    // Use domain as display text for plain URLs
                    try {
                        const domain = new URL(url).hostname;
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
            // Remove duplicates
            const uniqueLinks = links.filter((link, index, self) =>
                index === self.findIndex(l => l.url === link.url)
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
