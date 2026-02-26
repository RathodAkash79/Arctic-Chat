import { supabase } from '@/lib/supabase';
import type { ChatParticipant, GroupRole, MentionedUser } from '@/types';
import { encryptMessage } from '@/lib/crypto';

export interface CommandResult {
    success: boolean;
    message: string;
    systemText?: string; // sent to chat ONLY if success=true
}

/**
 * ══════════════════════════════════════════════════════════════
 * PERMISSION MATRIX
 * ══════════════════════════════════════════════════════════════
 *
 * /help        — all members
 * /announce    — admin, owner (styled system message)
 * /ban @user   — admin (not other admins), owner (anyone except self)
 * /unban @user — admin, owner  ← looks up ban list, NOT participants
 * /kick @user  — admin (not other admins), owner
 * /to @user    — admin (not other admins), owner (anyone except self)
 * /untimeout   — admin, owner
 * /mute @user  — admin (not other admins), owner
 * /unmute @user— admin, owner
 * /warn @user  — admin, owner
 * /promote @user — OWNER ONLY
 * /demote @user  — OWNER ONLY
 * /slowmode [secs] – OWNER ONLY
 * /nuke        — OWNER ONLY (wipes all group messages + S3 objects)
 * /nick [name] — all members (sets nickname for the group)
 */

// ── Low-level RPC helper ────────────────────────────────────────────────────

async function callRPC(
    chatId: string,
    action: string,
    opts: {
        targetUserId?: string;
        timeoutUntil?: string;
        reason?: string;
        durationMins?: number;
        slowmodeSecs?: number;
    } = {}
): Promise<{ ok: boolean; name?: string; error?: string; media_urls?: string[]; slowmode_secs?: number }> {
    const { data, error } = await supabase.rpc('execute_group_command', {
        p_chat_id: chatId,
        p_target_user_id: opts.targetUserId || null,
        p_action: action,
        p_timeout_until: opts.timeoutUntil || null,
        p_reason: opts.reason || 'No reason provided',
        p_duration_mins: opts.durationMins || null,
        p_slowmode_secs: opts.slowmodeSecs ?? 0,
    });

    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'No response from server' };

    return data as { ok: boolean; name?: string; error?: string; media_urls?: string[]; slowmode_secs?: number };
}

// ── resolve target ─────────────────────────────────────────────────────────
// For most commands: target must be in participants.
// For /unban: target may have been removed from participants; we look them
// up in the ban list + users table server-side so passing just the id is fine.

function resolveParticipant(
    mentions: MentionedUser[],
    participants: ChatParticipant[]
): { target: ChatParticipant | null; targetId: string | null; targetName: string | null } {
    const mention = mentions[0];
    if (!mention) return { target: null, targetId: null, targetName: null };
    const participant = participants.find(p => p.user_id === mention.id) || null;
    return {
        target: participant,
        targetId: mention.id,
        targetName: mention.display_name,
    };
}

// ── Main dispatcher ────────────────────────────────────────────────────────

export async function executeSlashCommand(
    rawInput: string,
    chatId: string,
    callerUserId: string,
    callerGroupRole: GroupRole,
    _callerRoleWeight: number,
    participants: ChatParticipant[],
    mentions: MentionedUser[] = [],
    onMediaDelete?: (urls: string[]) => Promise<void>
): Promise<CommandResult> {
    const trimmed = rawInput.trim();
    if (!trimmed.startsWith('/')) return { success: false, message: 'Not a command.' };

    const cmdMatch = trimmed.match(/^(\/\w+)/);
    if (!cmdMatch) return { success: false, message: 'Not a recognized command.' };

    const cmd = cmdMatch[1].toLowerCase().slice(1);
    const isAdminOrOwner = callerGroupRole === 'owner' || callerGroupRole === 'admin';
    const isOwner = callerGroupRole === 'owner';

    const { target, targetId, targetName } = resolveParticipant(mentions, participants);

    // Strip command + mention to get remaining text (reason, duration, etc.)
    let remaining = trimmed.slice(cmd.length + 1).trim();
    if (mentions[0]) {
        remaining = remaining.replace(`@${mentions[0].display_name}`, '').trim();
    }

    switch (cmd) {
        // ── Help ────────────────────────────────────────────────
        case 'help':
            return handleHelp(isAdminOrOwner, isOwner);

        // ── Nick ────────────────────────────────────────────────
        case 'nick':
            return handleNick(chatId, remaining);

        // ── Announce ────────────────────────────────────────────
        case 'announce':
            if (!isAdminOrOwner) return { success: false, message: 'Only admins/owner can make announcements.' };
            return handleAnnounce(remaining);

        // ── Ban ─────────────────────────────────────────────────
        case 'ban':
            if (!isAdminOrOwner) return { success: false, message: 'Only admins/owner can use /ban.' };
            if (!target) return { success: false, message: 'Select a @user from the suggestion list first.' };
            if (target.user_id === callerUserId) return { success: false, message: "You can't ban yourself." };
            return execRpc('ban', chatId, target.user_id, remaining, '🚫', 'has been banned from the group');

        // ── Unban ───────────────────────────────────────────────
        // Note: banned users are NOT in participants — use targetId from mention directly
        case 'unban': {
            if (!isAdminOrOwner) return { success: false, message: 'Only admins/owner can use /unban.' };
            if (!targetId) return { success: false, message: 'Select a @user from the suggestion list first.\n💡 Tip: Use the Ban List in the Group Info panel to unban easily.' };
            const res = await callRPC(chatId, 'unban', { targetUserId: targetId });
            if (!res.ok) return { success: false, message: res.error || 'Unban failed.' };
            const name = res.name || targetName || 'User';
            return {
                success: true,
                message: `${name} has been unbanned.`,
                systemText: `✅ ${name} has been unbanned. They can be re-invited now.`,
            };
        }

        // ── Kick ────────────────────────────────────────────────
        case 'kick':
            if (!isAdminOrOwner) return { success: false, message: 'Only admins/owner can use /kick.' };
            if (!target) return { success: false, message: 'Select a @user from the suggestion list first.' };
            if (target.user_id === callerUserId) return { success: false, message: "You can't kick yourself." };
            return execRpc('kick', chatId, target.user_id, remaining, '👢', 'has been kicked from the group');

        // ── Timeout ─────────────────────────────────────────────
        case 'to':
        case 'timeout':
            if (!isAdminOrOwner) return { success: false, message: 'Only admins/owner can use /to.' };
            return handleTimeout(chatId, callerUserId, target, remaining);

        // ── Untimeout ───────────────────────────────────────────
        case 'untimeout':
        case 'uto':
            if (!isAdminOrOwner) return { success: false, message: 'Only admins/owner can use /untimeout.' };
            if (!target) return { success: false, message: 'Select a @user from the suggestion list first.' };
            return execRpc('untimeout', chatId, target.user_id, '', '✅', 'timeout has been removed');

        // ── Mute ────────────────────────────────────────────────
        case 'mute':
            if (!isAdminOrOwner) return { success: false, message: 'Only admins/owner can use /mute.' };
            if (!target) return { success: false, message: 'Select a @user from the suggestion list first.' };
            return execRpc('mute', chatId, target.user_id, remaining, '🔇', 'has been muted in this group');

        // ── Unmute ──────────────────────────────────────────────
        case 'unmute':
            if (!isAdminOrOwner) return { success: false, message: 'Only admins/owner can use /unmute.' };
            if (!target) return { success: false, message: 'Select a @user from the suggestion list first.' };
            return execRpc('unmute', chatId, target.user_id, '', '🔊', 'has been unmuted');

        // ── Warn ────────────────────────────────────────────────
        case 'warn':
            if (!isAdminOrOwner) return { success: false, message: 'Only admins/owner can use /warn.' };
            if (!target) return { success: false, message: 'Select a @user from the suggestion list first.' };
            if (!remaining.trim()) return { success: false, message: 'Usage: /warn @user [reason]' };
            return handleWarn(chatId, callerUserId, target, remaining);

        // ── Promote ─────────────────────────────────────────────
        case 'promote':
            if (!isOwner) return { success: false, message: 'Only the group owner can promote members.' };
            if (!target) return { success: false, message: 'Select a @user from the suggestion list first.' };
            return execRpc('promote', chatId, target.user_id, '', '⬆️', 'has been promoted to Admin');

        // ── Demote ──────────────────────────────────────────────
        case 'demote':
            if (!isOwner) return { success: false, message: 'Only the group owner can demote admins.' };
            if (!target) return { success: false, message: 'Select a @user from the suggestion list first.' };
            return execRpc('demote', chatId, target.user_id, '', '⬇️', 'has been demoted to Member');

        // ── Slowmode ────────────────────────────────────────────
        case 'slowmode':
            if (!isOwner) return { success: false, message: 'Only the group owner can set slowmode.' };
            return handleSlowmode(chatId, remaining);

        // ── Nuke ────────────────────────────────────────────────
        case 'nuke':
            if (!isOwner) return { success: false, message: 'Only the group owner can use /nuke.' };
            return handleNuke(chatId, onMediaDelete);

        default:
            return { success: false, message: `Unknown command: /${cmd}. Type /help for the full list.` };
    }
}

// ── Simple RPC executor ────────────────────────────────────────────────────

async function execRpc(
    action: string,
    chatId: string,
    targetUserId: string,
    reason: string,
    emoji: string,
    verb: string
): Promise<CommandResult> {
    const res = await callRPC(chatId, action, { targetUserId, reason: reason || undefined });
    if (!res.ok) return { success: false, message: res.error || 'Action failed.' };

    const name = res.name || 'User';
    const reasonLine = reason ? `\nReason: ${reason}` : '';
    return {
        success: true,
        message: `${name} ${verb}.`,
        systemText: `${emoji} ${name} ${verb}.${reasonLine}`,
    };
}

// ── Timeout handler ────────────────────────────────────────────────────────

async function handleTimeout(
    chatId: string,
    callerUserId: string,
    target: ChatParticipant | null,
    remaining: string
): Promise<CommandResult> {
    if (!target) return { success: false, message: 'Select a @user from the suggestion list first.' };
    if (target.user_id === callerUserId) return { success: false, message: "You can't timeout yourself." };

    const durationMatch = remaining.match(/(\d+)/);
    if (!durationMatch) {
        return { success: false, message: 'Specify duration in minutes. Example: /to @user 10 spamming' };
    }

    const minutes = parseInt(durationMatch[1], 10);
    if (isNaN(minutes) || minutes <= 0) return { success: false, message: 'Duration must be a positive number.' };
    if (minutes > 43200) return { success: false, message: 'Maximum timeout is 30 days (43200 mins).' };

    const reason = remaining.replace(durationMatch[0], '').replace(/^(m|mins|minutes|min)\s*/i, '').trim();
    const timedUntil = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    const res = await callRPC(chatId, 'timeout', {
        targetUserId: target.user_id,
        timeoutUntil: timedUntil,
        reason: reason || 'No reason provided',
        durationMins: minutes,
    });

    if (!res.ok) return { success: false, message: res.error || 'Timeout failed.' };

    const name = res.name || target.user?.display_name || 'User';
    const reasonLine = reason ? `\nReason: ${reason}` : '';
    return {
        success: true,
        message: `${name} timed out for ${minutes} mins.`,
        systemText: `⏱️ ${name} has been timed out for ${minutes} minute${minutes > 1 ? 's' : ''}.${reasonLine}`,
    };
}

// ── Warn handler ───────────────────────────────────────────────────────────

async function handleWarn(
    chatId: string,
    _callerUserId: string,
    target: ChatParticipant,
    reason: string
): Promise<CommandResult> {
    const res = await callRPC(chatId, 'warn', {
        targetUserId: target.user_id,
        reason,
    });
    if (!res.ok) return { success: false, message: res.error || 'Warn failed.' };

    const name = res.name || target.user?.display_name || 'User';
    return {
        success: true,
        message: `Warning sent to ${name}.`,
        systemText: `⚠️ Warning to ${name}: ${reason}`,
    };
}

// ── Slowmode handler ───────────────────────────────────────────────────────

async function handleSlowmode(chatId: string, remaining: string): Promise<CommandResult> {
    const secsMatch = remaining.match(/^(\d+)/);
    const secs = secsMatch ? parseInt(secsMatch[1], 10) : 0;

    if (isNaN(secs) || secs < 0) return { success: false, message: 'Usage: /slowmode [seconds] (0 to disable)' };
    if (secs > 86400) return { success: false, message: 'Maximum slowmode is 86400 seconds (24 hours).' };

    const res = await callRPC(chatId, 'slowmode', { slowmodeSecs: secs });
    if (!res.ok) return { success: false, message: res.error || 'Slowmode failed.' };

    if (secs === 0) {
        return { success: true, message: 'Slowmode disabled.', systemText: '🐇 Slowmode has been disabled.' };
    }
    const label = secs < 60 ? `${secs}s` : `${Math.round(secs / 60)}m`;
    return {
        success: true,
        message: `Slowmode set to ${label}.`,
        systemText: `🐢 Slowmode has been enabled. Users can send one message every **${label}**.`,
    };
}

// ── Nuke handler ───────────────────────────────────────────────────────────

async function handleNuke(
    chatId: string,
    onMediaDelete?: (urls: string[]) => Promise<void>
): Promise<CommandResult> {
    const res = await callRPC(chatId, 'nuke');
    if (!res.ok) return { success: false, message: res.error || 'Nuke failed.' };

    // Delete S3 objects for any media that was in the chat
    if (res.media_urls && res.media_urls.length > 0 && onMediaDelete) {
        try {
            await onMediaDelete(res.media_urls);
        } catch (err) {
            console.warn('[nuke] S3 delete partially failed:', err);
        }
    }

    return {
        success: true,
        message: `Chat nuked. ${res.media_urls?.length || 0} media files also deleted.`,
        systemText: `💣 All messages have been deleted by the owner.`,
        isNuke: true,
    } as CommandResult & { isNuke?: boolean };
}

// ── Announce handler ───────────────────────────────────────────────────────

function handleAnnounce(message: string): CommandResult {
    if (!message.trim()) return { success: false, message: 'Usage: /announce [message]' };
    return {
        success: true,
        message: 'Announcement sent.',
        systemText: `📢 Announcement: ${message}`,
    };
}

// ── Help handler ───────────────────────────────────────────────────────────

function handleHelp(isAdmin: boolean, isOwner: boolean): CommandResult {
    const lines = [`🤖 **Arctic Chat Slash Commands**`];

    lines.push(`\n**📣 Everyone**`);
    lines.push(`• \`/help\` — Show this list`);
    lines.push(`• \`/nick [name]\` — Set a nickname in this group (empty to reset)`);

    if (isAdmin || isOwner) {
        lines.push(`\n**🛡️ Admin & Owner**`);
        lines.push(`• \`/ban @user [reason]\` — Ban user permanently`);
        lines.push(`• \`/unban @user\` — Remove user from ban list`);
        lines.push(`• \`/kick @user\` — Remove user from group`);
        lines.push(`• \`/to @user [mins] [reason]\` — Timeout user`);
        lines.push(`• \`/untimeout @user\` — Remove timeout`);
        lines.push(`• \`/mute @user [reason]\` — Mute user`);
        lines.push(`• \`/unmute @user\` — Unmute user`);
        lines.push(`• \`/warn @user [reason]\` — Send a formal warning`);
        lines.push(`• \`/announce [msg]\` — Send an announcement`);
    }

    if (isOwner) {
        lines.push(`\n**👑 Owner only**`);
        lines.push(`• \`/promote @user\` — Promote to Admin`);
        lines.push(`• \`/demote @user\` — Demote to Member`);
        lines.push(`• \`/slowmode [secs]\` — Set slowmode (0 to disable)`);
        lines.push(`• \`/nuke\` — 💣 Delete ALL messages & media`);
    }

    return {
        success: true,
        message: 'Help shown.',
        systemText: lines.join('\n'),
    };
}

// ── Task command (workspace chats) ─────────────────────────────────────────

async function handleNick(chatId: string, nickname: string): Promise<CommandResult> {
    const { error } = await supabase.rpc('set_group_nickname', {
        p_chat_id: chatId,
        p_nickname: nickname || null
    });

    if (error) return { success: false, message: `Failed to set nickname: ${error.message}` };

    if (!nickname) {
        return {
            success: true,
            message: 'Nickname reset.',
            systemText: '🏷️ Nickname has been reset to default display name.'
        };
    }

    return {
        success: true,
        message: `Nickname set to ${nickname}.`,
        systemText: `🏷️ Nickname has been set to **${nickname}**.`
    };
}

export async function executeTaskCommand(
    rawInput: string,
    chatId: string,
    callerUserId: string,
    participants: ChatParticipant[],
    mentions: MentionedUser[] = []
): Promise<CommandResult & { taskId?: string }> {
    if (!rawInput.startsWith('/task') || mentions.length === 0) {
        return { success: false, message: 'Usage: /task @username Task description' };
    }

    const targetMention = mentions[0];
    const targetParticipant = participants.find(p => p.user_id === targetMention.id) || null;
    if (!targetParticipant) return { success: false, message: 'User not found in this group.' };

    const description = rawInput.replace('/task', '').replace(`@${targetMention.display_name}`, '').trim();
    if (!description) return { success: false, message: 'Task description cannot be empty.' };

    const encryptedDescription = await encryptMessage(description);

    const { data, error } = await supabase
        .from('tasks')
        .insert({
            title: encryptedDescription,
            description: encryptedDescription,
            assigned_by: callerUserId,
            assigned_to_user_id: targetParticipant.user_id,
            assigned_to_role_weight: targetParticipant.user?.role_weight || 0,
            target_role_weight: targetParticipant.user?.role_weight || 0,
            chat_id: chatId,
            status: 'pending',
        })
        .select()
        .single();

    if (error) return { success: false, message: `Failed to create task: ${error.message}` };

    const name = targetParticipant.user?.display_name || 'User';
    return {
        success: true,
        message: `Task assigned to ${name}.`,
        taskId: data?.id,
        systemText: `📋 Task assigned to ${name}: ${description.slice(0, 100)}${description.length > 100 ? '…' : ''}`,
    };
}
