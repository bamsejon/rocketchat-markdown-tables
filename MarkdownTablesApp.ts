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
            i18nLabel: 'Table_Style',
            i18nDescription: 'Table_Style_Description',
            values: [
                { key: 'unicode', i18nLabel: 'Table_Style_Unicode' },
                { key: 'ascii', i18nLabel: 'Table_Style_ASCII' },
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

        // Get table style setting
        const tableStyle = await read.getEnvironmentReader().getSettings().getValueById('table_style');
        const chars = tableStyle === 'ascii' ? ASCII_CHARS : UNICODE_CHARS;

        let modifiedText = processedText;

        for (const table of tables) {
            const formattedTable = this.createFormattedTable(table, chars);
            modifiedText = modifiedText.replace(table.rawText, formattedTable);
        }

        modifiedText = modifiedText.replace(/\n{3,}/g, '\n\n').trim();

        builder.setText(modifiedText);

        return builder.getMessage();
    }

    private createFormattedTable(table: TableData, chars: typeof UNICODE_CHARS): string {
        // Calculate column widths using display width (accounting for emojis)
        const colWidths: number[] = [];
        for (let i = 0; i < table.headers.length; i++) {
            let maxWidth = this.getDisplayWidth(table.headers[i]);
            for (const row of table.rows) {
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
        const headerCells = table.headers.map((h, i) => {
            return ' ' + this.padCell(h, colWidths[i], table.alignments[i]) + ' ';
        });
        const headerLine = chars.vertical + headerCells.join(chars.vertical) + chars.vertical;

        lines.push('```');
        lines.push(topBorder);
        lines.push(headerLine);
        lines.push(headerSeparator);

        // Data rows - clean and simple with solid vertical lines
        for (const row of table.rows) {
            const cells = row.map((cell, i) => {
                return ' ' + this.padCell(cell || '', colWidths[i], table.alignments[i]) + ' ';
            });
            lines.push(chars.vertical + cells.join(chars.vertical) + chars.vertical);
        }

        lines.push(bottomBorder);
        lines.push('```');

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
