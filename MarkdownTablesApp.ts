import {
    IAppAccessors,
    ILogger,
    IHttp,
    IMessageBuilder,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { IMessage, IPreMessageSentModify } from '@rocket.chat/apps-engine/definition/messages';

import { parseMarkdownTable, TableData } from './lib/tableParser';

export class MarkdownTablesApp extends App implements IPreMessageSentModify {
    constructor(info: IAppInfo, logger: ILogger, accessors: IAppAccessors) {
        super(info, logger, accessors);
    }

    public async checkPreMessageSentModify(
        message: IMessage,
        read: IRead,
        http: IHttp
    ): Promise<boolean> {
        if (!message.text) {
            return false;
        }
        return message.text.includes('|') && message.text.includes('\n');
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

        const tables = parseMarkdownTable(message.text);

        if (tables.length === 0) {
            return message;
        }

        let modifiedText = message.text;

        for (const table of tables) {
            const formattedTable = this.createFormattedTable(table);
            modifiedText = modifiedText.replace(table.rawText, formattedTable);
        }

        modifiedText = modifiedText.replace(/\n{3,}/g, '\n\n').trim();

        builder.setText(modifiedText);

        return builder.getMessage();
    }

    private createFormattedTable(table: TableData): string {
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
        const separatorParts = colWidths.map(w => '─'.repeat(w + 2));
        const topBorder = '┌' + separatorParts.join('┬') + '┐';
        const headerSeparator = '├' + separatorParts.join('┼') + '┤';
        const bottomBorder = '└' + separatorParts.join('┴') + '┘';

        // Header row
        const headerCells = table.headers.map((h, i) => {
            return ' ' + this.padCell(h, colWidths[i], table.alignments[i]) + ' ';
        });
        const headerLine = '│' + headerCells.join('│') + '│';

        lines.push('```');
        lines.push(topBorder);
        lines.push(headerLine);
        lines.push(headerSeparator);

        // Create thin separator line (inside cells, keeps vertical lines solid)
        const thinSeparatorCells = colWidths.map(w => ' ' + '─'.repeat(w) + ' ');
        const thinRowSeparator = '│' + thinSeparatorCells.join('│') + '│';

        // Data rows with zebra striping and thin row separators
        for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
            const row = table.rows[rowIndex];
            const isShaded = rowIndex % 2 === 1; // Shade odd rows (0-indexed, so 2nd, 4th, etc.)
            const fillChar = isShaded ? '░' : ' ';

            // Keep space at borders for clean vertical lines, shade only inner content
            const cells = row.map((cell, i) => {
                const paddedContent = this.padCellWithChar(cell || '', colWidths[i], table.alignments[i], fillChar);
                return ' ' + paddedContent + ' ';
            });
            lines.push('│' + cells.join('│') + '│');

            // Add thin separator after each row except the last
            if (rowIndex < table.rows.length - 1) {
                lines.push(thinRowSeparator);
            }
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
