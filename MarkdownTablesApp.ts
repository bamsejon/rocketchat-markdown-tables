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
        await configuration.settings.provideSetting({
            id: 'table_style',
            type: SettingType.SELECT,
            packageValue: 'unicode',
            required: false,
            public: false,
            i18nLabel: 'Table Style',
            i18nDescription: 'Choose the character set for table borders',
            values: [
                { key: 'unicode', i18nLabel: 'Unicode (box-drawing)' },
                { key: 'ascii', i18nLabel: 'ASCII (+, -, |)' },
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
        const chars = tableStyle === 'ascii' ? ASCII_CHARS : UNICODE_CHARS;

        // Disable link previews if setting is enabled
        if (disableLinkPreviews !== false) {
            builder.setParseUrls(false);
        }

        let modifiedText = processedText;

        for (const table of tables) {
            const formattedTable = this.createFormattedTable(table, chars, showLinksBelow !== false);
            modifiedText = modifiedText.replace(table.rawText, formattedTable);
        }

        modifiedText = modifiedText.replace(/\n{3,}/g, '\n\n').trim();

        builder.setText(modifiedText);

        return builder.getMessage();
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
