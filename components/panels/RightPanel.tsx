'use client';

import { useState, useMemo } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { useChats } from '@/hooks/useChats';
import { supabase } from '@/lib/supabase';
import { X, Users, UserPlus, LogOut, MoreVertical, Shield, ShieldAlert, UserMinus, ShieldOff } from 'lucide-react';
import AddMemberModal from '../modals/AddMemberModal';
import styles from './RightPanel.module.scss';

export default function RightPanel() {
  const { currentUser, currentChat, setIsRightPanelOpen } = useAppStore();
  const { fetchChats } = useChats();

  const [showAddModal, setShowAddModal] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const myRole = useMemo(() => {
    if (!currentChat || !currentUser) return null;
    return currentChat.participants?.find(p => p.user_id === currentUser.id)?.group_role || null;
  }, [currentChat, currentUser]);

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
    setLeaving(false);
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

      {/* Participants */}
      {currentChat.participants && currentChat.participants.length > 0 && (
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
              <div key={p.user_id} className={styles.participantItem}>
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
