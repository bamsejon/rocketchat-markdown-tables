import {
    IAppAccessors,
    IConfigurationExtend,
    ILogger,
    IHttp,
    IMessageBuilder,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import { App } from '@rocket.chat/apps-engine/definition/App';
import { IAppInfo } from '@rocket.chat/apps-engine/definition/metadata';
import { IMessage, IPreMessageSentModify } from '@rocket.chat/apps-engine/definition/messages';
import { IMessageAttachment, IMessageAttachmentField } from '@rocket.chat/apps-engine/definition/messages';

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
        // Only process messages that contain potential tables
        if (!message.text) {
            return false;
        }
        // Check for pipe characters which indicate a potential table
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

        // Convert tables to attachments
        const attachments: IMessageAttachment[] = message.attachments || [];
        let modifiedText = message.text;

        for (const table of tables) {
            // Create an attachment for each table
            const attachment = this.createTableAttachment(table);
            attachments.push(attachment);

            // Remove the table from the message text
            modifiedText = modifiedText.replace(table.rawText, '');
        }

        // Clean up extra newlines
        modifiedText = modifiedText.replace(/\n{3,}/g, '\n\n').trim();

        builder.setText(modifiedText || ' ');
        builder.setAttachments(attachments);

        return builder.getMessage();
    }

    private createTableAttachment(table: TableData): IMessageAttachment {
        const fields: IMessageAttachmentField[] = [];

        // For each row, create a formatted display
        for (let rowIndex = 0; rowIndex < table.rows.length; rowIndex++) {
            const row = table.rows[rowIndex];

            // Create a field for each row showing all columns
            const rowValues: string[] = [];
            for (let colIndex = 0; colIndex < table.headers.length; colIndex++) {
                const header = table.headers[colIndex];
                const value = row[colIndex] || '';
                rowValues.push(`**${header}:** ${value}`);
            }

            fields.push({
                short: false,
                title: `Row ${rowIndex + 1}`,
                value: rowValues.join('\n'),
            });
        }

        // Alternative: Create fields per column for smaller tables
        if (table.rows.length <= 5 && table.headers.length <= 4) {
            fields.length = 0; // Clear and use column-based layout

            for (let colIndex = 0; colIndex < table.headers.length; colIndex++) {
                const header = table.headers[colIndex];
                const values = table.rows.map(row => row[colIndex] || '-').join('\n');

                fields.push({
                    short: table.headers.length > 2,
                    title: header,
                    value: values,
                });
            }
        }

        return {
            color: '#4A90A4',
            title: {
                value: 'Table',
            },
            fields,
            collapsed: false,
        };
    }
}
