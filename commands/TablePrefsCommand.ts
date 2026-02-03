import {
    IHttp,
    IModify,
    IPersistence,
    IRead,
} from '@rocket.chat/apps-engine/definition/accessors';
import {
    ISlashCommand,
    SlashCommandContext,
} from '@rocket.chat/apps-engine/definition/slashcommands';
import { IUser } from '@rocket.chat/apps-engine/definition/users';
import { IRoom } from '@rocket.chat/apps-engine/definition/rooms';
import { RocketChatAssociationModel, RocketChatAssociationRecord } from '@rocket.chat/apps-engine/definition/metadata';

export interface UserTablePrefs {
    showLinksBelow: boolean;
}

export class TablePrefsCommand implements ISlashCommand {
    public command = 'tableprefs';
    public i18nParamsExample = 'links on/off';
    public i18nDescription = 'Set your personal table display preferences';
    public providesPreview = false;

    public async executor(
        context: SlashCommandContext,
        read: IRead,
        modify: IModify,
        http: IHttp,
        persistence: IPersistence
    ): Promise<void> {
        const args = context.getArguments();
        const sender = context.getSender();
        const room = context.getRoom();

        if (args.length === 0) {
            // Show current settings
            const prefs = await this.getUserPrefs(read, sender.id);
            await this.sendNotifyMessage(
                room,
                sender,
                modify,
                `**Your Table Preferences:**\n` +
                `- Show links below image: **${prefs.showLinksBelow ? 'on' : 'off'}**\n\n` +
                `**Usage:**\n` +
                `\`/tableprefs links on\` - Show links below table image\n` +
                `\`/tableprefs links off\` - Hide links below table image`
            );
            return;
        }

        const setting = args[0]?.toLowerCase();
        const value = args[1]?.toLowerCase();

        if (setting === 'links') {
            if (value === 'on' || value === 'off') {
                const prefs = await this.getUserPrefs(read, sender.id);
                prefs.showLinksBelow = value === 'on';
                await this.saveUserPrefs(persistence, sender.id, prefs);
                await this.sendNotifyMessage(
                    room,
                    sender,
                    modify,
                    `Links below table image: **${value}**`
                );
            } else {
                await this.sendNotifyMessage(
                    room,
                    sender,
                    modify,
                    `**Usage:** \`/tableprefs links on\` or \`/tableprefs links off\``
                );
            }
        } else {
            await this.sendNotifyMessage(
                room,
                sender,
                modify,
                `**Unknown setting:** ${setting}\n\n` +
                `**Available settings:**\n` +
                `- \`links on/off\` - Show/hide links below table image`
            );
        }
    }

    public static getUserAssociation(userId: string): RocketChatAssociationRecord {
        return new RocketChatAssociationRecord(
            RocketChatAssociationModel.USER,
            `tableprefs_${userId}`
        );
    }

    public async getUserPrefs(read: IRead, userId: string): Promise<UserTablePrefs> {
        const association = TablePrefsCommand.getUserAssociation(userId);
        const records = await read.getPersistenceReader().readByAssociation(association);

        if (records && records.length > 0) {
            return records[0] as UserTablePrefs;
        }

        // Default preferences
        return {
            showLinksBelow: true,
        };
    }

    private async saveUserPrefs(persistence: IPersistence, userId: string, prefs: UserTablePrefs): Promise<void> {
        const association = TablePrefsCommand.getUserAssociation(userId);
        await persistence.removeByAssociation(association);
        await persistence.createWithAssociation(prefs, association);
    }

    private async sendNotifyMessage(room: IRoom, sender: IUser, modify: IModify, text: string): Promise<void> {
        const notifier = modify.getNotifier();
        const messageBuilder = notifier.getMessageBuilder()
            .setRoom(room)
            .setSender(sender)
            .setText(text);

        await notifier.notifyUser(sender, messageBuilder.getMessage());
    }
}
