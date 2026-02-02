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
        // Calculate column widths
        const colWidths: number[] = [];
        for (let i = 0; i < table.headers.length; i++) {
            let maxWidth = table.headers[i].length;
            for (const row of table.rows) {
                const cellLen = (row[i] || '').length;
                if (cellLen > maxWidth) {
                    maxWidth = cellLen;
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

        // Data rows
        for (const row of table.rows) {
            const cells = row.map((cell, i) => {
                return ' ' + this.padCell(cell || '', colWidths[i], table.alignments[i]) + ' ';
            });
            lines.push('│' + cells.join('│') + '│');
        }

        lines.push(bottomBorder);
        lines.push('```');

        return lines.join('\n');
    }

    private padCell(text: string, width: number, align: string): string {
        const padding = width - text.length;
        if (padding <= 0) return text;

        if (align === 'center') {
            const left = Math.floor(padding / 2);
            const right = padding - left;
            return ' '.repeat(left) + text + ' '.repeat(right);
        } else if (align === 'right') {
            return ' '.repeat(padding) + text;
        } else {
            return text + ' '.repeat(padding);
        }
    }
}
