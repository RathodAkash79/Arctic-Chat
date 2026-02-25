import { supabase } from '@/lib/supabase';
import type { ChatParticipant, GroupRole } from '@/types';
import { encryptMessage } from '@/lib/crypto';

export interface CommandResult {
    success: boolean;
    message: string;
    systemText?: string; // shown in chat as system message
}

/**
 * Resolve @mention to a participant
 */
function resolveTarget(mention: string, participants: ChatParticipant[]): ChatParticipant | null {
    const name = mention.replace(/^@/, '').toLowerCase();
    return participants.find(
        (p) => p.user?.display_name?.toLowerCase() === name
    ) || null;
}

/**
 * Main entry — parses and executes slash commands in group chats.
 * Only callable if caller is owner/admin in the group.
 */
export async function executeSlashCommand(
    rawInput: string,
    chatId: string,
    callerUserId: string,
    callerGroupRole: GroupRole,
    _callerRoleWeight: number,
    participants: ChatParticipant[]
): Promise<CommandResult> {
    const trimmed = rawInput.trim();

    if (!trimmed.startsWith('/')) {
        return { success: false, message: 'Not a command.' };
    }

    const [cmd, ...args] = trimmed.slice(1).split(/\s+/);
    const commandLower = cmd.toLowerCase();

    const isAdminOrOwner = callerGroupRole === 'owner' || callerGroupRole === 'admin';

    switch (commandLower) {
        case 'help':
            return handleHelp(isAdminOrOwner);

        case 'ban':
            if (!isAdminOrOwner) return { success: false, message: 'Only group admins can use /ban.' };
            return handleBan(args, chatId, callerUserId, participants);

        case 'to':
            if (!isAdminOrOwner) return { success: false, message: 'Only group admins can use /to.' };
            return handleTimeout(args, chatId, participants);

        case 'promote':
            if (!isAdminOrOwner) return { success: false, message: 'Only group admins can use /promote.' };
            return handlePromote(args, chatId, callerUserId, participants);

        case 'demote':
            if (!isAdminOrOwner) return { success: false, message: 'Only group admins can use /demote.' };
            return handleDemote(args, chatId, callerUserId, participants);

        default:
            return { success: false, message: `Unknown command: /${cmd}. Type /help for available commands.` };
    }
}

function handleHelp(isAdmin: boolean): CommandResult {
    const adminCommands = isAdmin
        ? '\n**/ban @user** — Remove & ban from group\n**/to @user [minutes]** — Timeout (default 60 min)\n**/promote @user** — Make admin\n**/demote @user** — Remove admin'
        : '';
    return {
        success: true,
        message: 'Help displayed.',
        systemText: `**Available Commands**${adminCommands}\n**/help** — Show this list`,
    };
}

async function handleBan(
    args: string[],
    chatId: string,
    callerUserId: string,
    participants: ChatParticipant[]
): Promise<CommandResult> {
    if (!args[0]) return { success: false, message: 'Usage: /ban @username' };

    const target = resolveTarget(args[0], participants);
    if (!target) return { success: false, message: `User "${args[0]}" not found in this group.` };
    if (target.user_id === callerUserId) return { success: false, message: "You can't ban yourself." };
    if (target.group_role === 'owner') return { success: false, message: "You can't ban the group owner." };

    const { error } = await supabase
        .from('chat_participants')
        .delete()
        .eq('chat_id', chatId)
        .eq('user_id', target.user_id);

    if (error) return { success: false, message: `Failed to ban: ${error.message}` };

    return {
        success: true,
        message: `${target.user?.display_name} has been removed from the group.`,
        systemText: `🚫 ${target.user?.display_name} was removed from this group.`,
    };
}

async function handleTimeout(
    args: string[],
    chatId: string,
    participants: ChatParticipant[]
): Promise<CommandResult> {
    if (!args[0]) return { success: false, message: 'Usage: /to @username [minutes]' };

    const target = resolveTarget(args[0], participants);
    if (!target) return { success: false, message: `User "${args[0]}" not found.` };

    const minutes = parseInt(args[1] || '60', 10);
    if (isNaN(minutes) || minutes <= 0) return { success: false, message: 'Invalid duration. Use a positive number of minutes.' };

    const timedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    const { error } = await supabase
        .from('group_timeouts')
        .upsert({ chat_id: chatId, user_id: target.user_id, timed_until: timedUntil });

    if (error) return { success: false, message: `Failed to timeout: ${error.message}` };

    return {
        success: true,
        message: `${target.user?.display_name} timed out for ${minutes} minutes.`,
        systemText: `⏱️ ${target.user?.display_name} has been muted for ${minutes} minutes.`,
    };
}

async function handlePromote(
    args: string[],
    chatId: string,
    callerUserId: string,
    participants: ChatParticipant[]
): Promise<CommandResult> {
    if (!args[0]) return { success: false, message: 'Usage: /promote @username' };

    const target = resolveTarget(args[0], participants);
    if (!target) return { success: false, message: `User "${args[0]}" not found.` };
    if (target.user_id === callerUserId) return { success: false, message: "You can't promote yourself." };
    if (target.group_role === 'owner') return { success: false, message: 'Owner cannot be promoted further.' };

    const { error } = await supabase
        .from('chat_participants')
        .update({ group_role: 'admin' })
        .eq('chat_id', chatId)
        .eq('user_id', target.user_id);

    if (error) return { success: false, message: `Failed to promote: ${error.message}` };

    return {
        success: true,
        message: `${target.user?.display_name} promoted to admin.`,
        systemText: `⬆️ ${target.user?.display_name} has been promoted to admin.`,
    };
}

async function handleDemote(
    args: string[],
    chatId: string,
    callerUserId: string,
    participants: ChatParticipant[]
): Promise<CommandResult> {
    if (!args[0]) return { success: false, message: 'Usage: /demote @username' };

    const target = resolveTarget(args[0], participants);
    if (!target) return { success: false, message: `User "${args[0]}" not found.` };
    if (target.user_id === callerUserId) return { success: false, message: "You can't demote yourself." };
    if (target.group_role === 'owner') return { success: false, message: "You can't demote the group owner." };

    const { error } = await supabase
        .from('chat_participants')
        .update({ group_role: 'member' })
        .eq('chat_id', chatId)
        .eq('user_id', target.user_id);

    if (error) return { success: false, message: `Failed to demote: ${error.message}` };

    return {
        success: true,
        message: `${target.user?.display_name} demoted to member.`,
        systemText: `⬇️ ${target.user?.display_name} has been demoted to member.`,
    };
}

/**
 * Parse and execute /task command for workspace chats.
 * Format: /task @user Task description here
 */
export async function executeTaskCommand(
    rawInput: string,
    chatId: string,
    callerUserId: string,
    participants: ChatParticipant[]
): Promise<CommandResult & { taskId?: string }> {
    const match = rawInput.match(/^\/task\s+(@\S+)\s+(.+)$/s);
    if (!match) {
        return { success: false, message: 'Usage: /task @username Task description' };
    }

    const [, mention, description] = match;
    const target = resolveTarget(mention, participants);
    if (!target) return { success: false, message: `User "${mention}" not found in this group.` };

    // Encrypt the task title/description
    const encryptedDescription = await encryptMessage(description.trim());

    const { data, error } = await supabase
        .from('tasks')
        .insert({
            title: encryptedDescription,
            description: encryptedDescription,
            assigned_by: callerUserId,
            assigned_to_user_id: target.user_id,
            assigned_to_role_weight: target.user?.role_weight || 0,
            target_role_weight: target.user?.role_weight || 0,
            chat_id: chatId,
            status: 'pending',
        })
        .select()
        .single();

    if (error) return { success: false, message: `Failed to create task: ${error.message}` };

    return {
        success: true,
        message: `Task assigned to ${target.user?.display_name}.`,
        taskId: data?.id,
        systemText: `📋 Task assigned to ${target.user?.display_name}: ${description.slice(0, 60)}${description.length > 60 ? '…' : ''}`,
    };
}
