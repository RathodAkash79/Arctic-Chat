'use client';

import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAppStore } from '@/store/useAppStore';
import { useChats } from '@/hooks/useChats';
import { supabase } from '@/lib/supabase';
import { X, Users, UserPlus, LogOut, MoreVertical, Shield, ShieldAlert, UserMinus, ShieldOff, Hammer, Ban, BarChart2, Image as ImageIcon, Link as LinkIcon, Calendar, MessageSquare } from 'lucide-react';
import AddMemberModal from '../modals/AddMemberModal';
import { resolveImageUrl } from '@/lib/utils';
import { decryptMessage } from '@/lib/crypto';
import styles from './RightPanel.module.scss';

interface BannedUser {
  user_id: string;
  display_name: string;
  pfp_url: string;
  reason: string;
  banned_at: string;
  banned_by_name: string;
}

export default function RightPanel() {
  const router = useRouter();
  const { currentUser, currentChat, setIsRightPanelOpen } = useAppStore();
  const { fetchChats } = useChats();

  const [showAddModal, setShowAddModal] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);
  const [banList, setBanList] = useState<BannedUser[]>([]);
  const [loadingBans, setLoadingBans] = useState(false);

  // DM Tabs State
  const [dmTab, setDmTab] = useState<'stats' | 'images' | 'links'>('stats');
  const [dmStats, setDmStats] = useState({ msgCount: 0, firstDate: '' });
  const [dmImages, setDmImages] = useState<any[]>([]);
  const [dmLinks, setDmLinks] = useState<any[]>([]);
  const [loadingDm, setLoadingDm] = useState(false);

  const isAdminOrOwner = useMemo(() => {
    if (!currentChat || !currentUser) return false;
    const role = currentChat.participants?.find(p => p.user_id === currentUser.id)?.group_role;
    return role === 'owner' || role === 'admin';
  }, [currentChat, currentUser]);

  const myRole = useMemo(() => {
    if (!currentChat || !currentUser) return null;
    return currentChat.participants?.find(p => p.user_id === currentUser.id)?.group_role || null;
  }, [currentChat, currentUser]);

  // Fetch ban list if admin/owner
  const fetchBanList = async () => {
    if (!currentChat || !isAdminOrOwner) return;
    setLoadingBans(true);
    try {
      const { data, error } = await supabase.rpc('get_group_ban_list', { p_chat_id: currentChat.id });
      if (error) throw error;
      if (data?.ok) {
        setBanList(data.bans || []);
      }
    } catch (err) {
      console.error('Failed to fetch ban list:', err);
    } finally {
      setLoadingBans(false);
    }
  };

  const fetchDmData = async () => {
    if (!currentChat || currentChat.type !== 'dm') return;
    setLoadingDm(true);
    try {
      // 1. Stats
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('chat_id', currentChat.id);

      const { data: firstMsg } = await supabase
        .from('messages')
        .select('created_at')
        .eq('chat_id', currentChat.id)
        .order('created_at', { ascending: true })
        .limit(1);

      setDmStats({
        msgCount: count || 0,
        firstDate: firstMsg?.[0]?.created_at || currentChat.created_at
      });

      // 2. Images
      const { data: imgData } = await supabase
        .from('messages')
        .select('id, media_url, created_at, expires_at')
        .eq('chat_id', currentChat.id)
        .not('media_url', 'is', null)
        .order('created_at', { ascending: false });

      if (imgData) {
        const now = Date.now();
        const validImgs = imgData.filter(m => !m.expires_at || new Date(m.expires_at).getTime() > now);
        setDmImages(validImgs);
      } else {
        setDmImages([]);
      }

      // 3. Links
      const { data: allMsgs } = await supabase
        .from('messages')
        .select('id, text, link_preview, created_at')
        .eq('chat_id', currentChat.id)
        .order('created_at', { ascending: false })
        .limit(200);

      if (allMsgs) {
        const extractedLinks: any[] = [];
        for (const msg of allMsgs) {
          if (msg.link_preview && msg.link_preview.url) {
            extractedLinks.push(msg);
            continue;
          }
          if (!msg.text || msg.text === '[deleted]' || msg.is_deleted) continue;

          try {
            const dec = await decryptMessage(msg.text).catch(() => msg.text);
            const urlMatch = dec.match(/(https?:\/\/[^\s]+)/g);
            if (urlMatch) {
              urlMatch.forEach((url: string) => {
                extractedLinks.push({
                  id: msg.id + url,
                  created_at: msg.created_at,
                  link_preview: { url, title: url, description: '' }
                });
              });
            }
          } catch (e) { /* ignore */ }
        }
        setDmLinks(extractedLinks);
      } else {
        setDmLinks([]);
      }
    } catch (e) {
      console.error(e);
    }
    setLoadingDm(false);
  };

  useEffect(() => {
    fetchBanList();
    if (currentChat?.type === 'dm') fetchDmData();
  }, [currentChat?.id, isAdminOrOwner]);

  const handleLeaveGroup = async () => {
    if (!currentChat) return;
    if (!confirm('Are you sure you want to leave this group?')) return;

    setLeaving(true);
    try {
      await supabase.rpc('leave_group', { p_chat_id: currentChat.id });
      fetchChats();
      setIsRightPanelOpen(false);
    } catch (err) {
      console.error('Failed to leave:', err);
    }
    setLeaving(true);
  };

  const handleParticipantClick = async (targetUserId: string) => {
    if (!currentUser || targetUserId === currentUser.id) return;

    const existingLocal = useAppStore.getState().chats.find(
      (c) => c.type === 'dm' && c.participants?.some((p) => p.user_id === targetUserId)
    );
    if (existingLocal) {
      useAppStore.getState().setCurrentChat(existingLocal);
      useAppStore.getState().setIsMobileChatOpen(true);
      router.push(`/${existingLocal.id}`);
      setIsRightPanelOpen(false);
      return;
    }

    try {
      const { data, error } = await supabase.rpc('get_or_create_dm_chat_v2', { target_user_id: targetUserId });
      if (error) throw error;
      if (data) {
        router.push(`/${data}`);
        setIsRightPanelOpen(false);
      }
    } catch (err) {
      console.error('Failed to open DM:', err);
    }
  };

  const handleRoleChange = async (targetUserId: string, newRole: string) => {
    if (!currentChat) return;
    try {
      await supabase.rpc('update_group_role', {
        p_chat_id: currentChat.id,
        p_target_user_id: targetUserId,
        p_new_role: newRole
      });
      fetchChats();
      setActiveMenuId(null);
    } catch (err) {
      console.error('Role update failed:', err);
      alert('Failed to update role');
    }
  };

  const handleRemoveMember = async (targetUserId: string) => {
    if (!currentChat) return;
    if (!confirm('Remove this user from the group?')) return;
    try {
      await supabase.rpc('remove_group_member', {
        p_chat_id: currentChat.id,
        p_target_user_id: targetUserId
      });
      fetchChats();
      setActiveMenuId(null);
    } catch (err) {
      console.error('Remove failed:', err);
      alert('Failed to remove user');
    }
  };

  const handleUnban = async (targetUserId: string) => {
    if (!currentChat) return;
    try {
      const { data, error } = await supabase.rpc('execute_group_command', {
        p_chat_id: currentChat.id,
        p_target_user_id: targetUserId,
        p_action: 'unban'
      });
      if (error) throw error;
      if (data?.ok) {
        fetchBanList();
      } else {
        alert(data?.error || 'Unban failed');
      }
    } catch (err) {
      console.error('Unban failed:', err);
    }
  };

  const chatDisplayName = useMemo(() => {
    if (!currentChat) return '';
    if (currentChat.type === 'dm') {
      return currentChat.dm_user?.display_name || 'Chat';
    }
    return currentChat.name || 'Group';
  }, [currentChat]);

  const chatDisplayAvatar = useMemo(() => {
    if (!currentChat) return '';
    if (currentChat.type === 'dm') return currentChat.dm_user?.pfp_url || '';
    return currentChat.pfp_url || '';
  }, [currentChat]);

  if (!currentChat) return null;

  return (
    <div className={styles.panel}>
      {/* Header */}
      <div className={styles.header}>
        <h3>Chat Info</h3>
        <button
          className={styles.closeBtn}
          onClick={() => setIsRightPanelOpen(false)}
        >
          <X size={20} />
        </button>
      </div>

      {/* Chat Avatar & Name */}
      <div className={styles.profile}>
        <div className={styles.avatar}>
          {chatDisplayAvatar ? (
            <img src={chatDisplayAvatar} alt="" />
          ) : (
            <span>{chatDisplayName[0]?.toUpperCase() || '?'}</span>
          )}
        </div>
        <h4>{chatDisplayName}</h4>
        {currentChat.type === 'group' && currentChat.description && (
          <p className={styles.description}>{currentChat.description}</p>
        )}
      </div>

      {/* DM Tabs */}
      {currentChat.type === 'dm' && (
        <div className={styles.dmTabsContainer}>
          <div className={styles.tabsHeader}>
            <button
              className={`${styles.tabBtn} ${dmTab === 'stats' ? styles.activeTab : ''}`}
              onClick={() => setDmTab('stats')}
            >
              <BarChart2 size={16} /> Stats
            </button>
            <button
              className={`${styles.tabBtn} ${dmTab === 'images' ? styles.activeTab : ''}`}
              onClick={() => setDmTab('images')}
            >
              <ImageIcon size={16} /> Images
            </button>
            <button
              className={`${styles.tabBtn} ${dmTab === 'links' ? styles.activeTab : ''}`}
              onClick={() => setDmTab('links')}
            >
              <LinkIcon size={16} /> Links
            </button>
          </div>

          <div className={styles.tabContent}>
            {loadingDm ? (
              <div className={styles.loadingSmall}>Loading...</div>
            ) : (
              <>
                {dmTab === 'stats' && (
                  <div className={styles.statsTab}>
                    <div className={styles.statBox}>
                      <MessageSquare size={18} />
                      <div className={styles.statInfo}>
                        <span className={styles.statValue}>{dmStats.msgCount}</span>
                        <span className={styles.statLabel}>Total Messages</span>
                      </div>
                    </div>
                    <div className={styles.statBox}>
                      <Calendar size={18} />
                      <div className={styles.statInfo}>
                        <span className={styles.statValue}>
                          {new Date(dmStats.firstDate).toLocaleDateString()}
                        </span>
                        <span className={styles.statLabel}>Chat Started</span>
                      </div>
                    </div>
                    <div className={styles.statBox}>
                      <Calendar size={18} />
                      <div className={styles.statInfo}>
                        <span className={styles.statValue}>
                          {new Date(currentChat.dm_user?.created_at || '').toLocaleDateString()}
                        </span>
                        <span className={styles.statLabel}>Joined ArcticChat</span>
                      </div>
                    </div>
                  </div>
                )}

                {dmTab === 'images' && (
                  <div className={styles.imagesTab}>
                    <div className={styles.tabSubtitle}>
                      {dmImages.length} Image{dmImages.length !== 1 ? 's' : ''}
                    </div>
                    <div className={styles.imageGrid}>
                      {dmImages.map((img) => (
                        <a
                          key={img.id}
                          href={resolveImageUrl(img.media_url)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.imageGridItem}
                        >
                          <img src={resolveImageUrl(img.media_url)} alt="Shared media" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {dmTab === 'links' && (
                  <div className={styles.linksTab}>
                    <div className={styles.tabSubtitle}>
                      {dmLinks.length} Link{dmLinks.length !== 1 ? 's' : ''}
                    </div>
                    <div className={styles.linkList}>
                      {dmLinks.map((link) => (
                        <a
                          key={link.id}
                          href={link.link_preview.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.linkItem}
                        >
                          <div className={styles.linkInfo}>
                            <span className={styles.linkTitle}>{link.link_preview.title || link.link_preview.url}</span>
                            <span className={styles.linkDesc}>{link.link_preview.description || 'No description preview available'}</span>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Participants */}
      {currentChat.type === 'group' && currentChat.participants && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>
              <Users size={16} />
              <span>
                {currentChat.participants.length} participant
                {currentChat.participants.length !== 1 ? 's' : ''}
              </span>
            </div>

            {currentChat.type === 'group' && (myRole === 'owner' || myRole === 'admin') && (
              <button className={styles.addMemberBtn} onClick={() => setShowAddModal(true)}>
                <UserPlus size={14} /> Add
              </button>
            )}
          </div>
          <div className={styles.participantList}>
            {currentChat.participants.map((p) => (
              <div
                key={p.user_id}
                className={styles.participantItem}
                onClick={() => handleParticipantClick(p.user_id)}
                style={{ cursor: p.user_id !== currentUser?.id ? 'pointer' : 'default' }}
              >
                <div className={styles.participantAvatar}>
                  {p.user?.pfp_url ? (
                    <img src={p.user.pfp_url} alt="" />
                  ) : (
                    <span>
                      {p.user?.display_name?.[0]?.toUpperCase() || '?'}
                    </span>
                  )}
                </div>
                <div className={styles.participantInfo}>
                  <span className={styles.participantName}>
                    {p.user?.display_name || 'User'}
                  </span>
                  {p.group_role !== 'member' && (
                    <span className={styles.participantRole}>
                      {p.group_role}
                    </span>
                  )}
                </div>

                {/* Moderation Context Menu */}
                {currentChat.type === 'group' && p.user_id !== currentUser?.id && (myRole === 'owner' || myRole === 'admin') && (
                  <div className={styles.modActions}>
                    <button
                      className={styles.menuTrigger}
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveMenuId(activeMenuId === p.user_id ? null : p.user_id);
                      }}
                    >
                      <MoreVertical size={16} />
                    </button>

                    {activeMenuId === p.user_id && (
                      <div className={styles.contextMenu}>
                        {/* Owner only options */}
                        {myRole === 'owner' && p.group_role !== 'admin' && (
                          <button onClick={() => handleRoleChange(p.user_id, 'admin')}>
                            <Shield size={14} /> Promote to Admin
                          </button>
                        )}
                        {myRole === 'owner' && p.group_role === 'admin' && (
                          <button onClick={() => handleRoleChange(p.user_id, 'member')}>
                            <ShieldOff size={14} /> Demote to Member
                          </button>
                        )}
                        {myRole === 'owner' && (
                          <button onClick={() => handleRoleChange(p.user_id, 'owner')}>
                            <ShieldAlert size={14} /> Transfer Ownership
                          </button>
                        )}

                        {/* Owner OR Admin options (Admin can only remove members) */}
                        {(myRole === 'owner' || (myRole === 'admin' && p.group_role === 'member')) && (
                          <button className={styles.dangerAction} onClick={() => handleRemoveMember(p.user_id)}>
                            <UserMinus size={14} /> Remove from Group
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ban List Section (Admins/Owner only) */}
      {isAdminOrOwner && currentChat.type === 'group' && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <div className={styles.sectionTitle}>
              <Ban size={16} />
              <span>Ban List ({banList.length})</span>
            </div>
          </div>
          <div className={styles.participantList}>
            {loadingBans && <div className={styles.loadingSmall}>Loading...</div>}
            {!loadingBans && banList.length === 0 && <p className={styles.emptyText}>No users banned</p>}
            {banList.map((b) => (
              <div key={b.user_id} className={styles.participantItem}>
                <div className={styles.participantAvatar}>
                  {b.pfp_url ? (
                    <img src={b.pfp_url} alt="" />
                  ) : (
                    <span>{b.display_name[0]?.toUpperCase()}</span>
                  )}
                </div>
                <div className={styles.participantInfo}>
                  <span className={styles.participantName}>{b.display_name}</span>
                  <span className={styles.banReason}>{b.reason || 'No reason'}</span>
                </div>
                <button
                  className={styles.unbanBtn}
                  onClick={() => handleUnban(b.user_id)}
                  title="Unban User"
                >
                  <Hammer size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leave Group / Delete Direct Message (For later) */}
      {currentChat.type === 'group' && (
        <div className={styles.section}>
          <button
            className={styles.leaveGroupBtn}
            onClick={handleLeaveGroup}
            disabled={leaving}
          >
            <LogOut size={16} />
            {leaving ? 'Leaving...' : 'Leave Group'}
          </button>
        </div>
      )}

      {showAddModal && <AddMemberModal onClose={() => setShowAddModal(false)} />}
    </div>
  );
}
