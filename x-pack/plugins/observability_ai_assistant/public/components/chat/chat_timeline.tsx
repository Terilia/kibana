/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { ReactNode, useMemo } from 'react';
import { css } from '@emotion/css';
import { EuiCommentList } from '@elastic/eui';
import type { AuthenticatedUser } from '@kbn/security-plugin/common';
import { omit } from 'lodash';
import type { Feedback } from '../feedback_buttons';
import type { Message } from '../../../common';
import type { UseKnowledgeBaseResult } from '../../hooks/use_knowledge_base';
import type { ChatActionClickHandler, ChatFlyoutSecondSlotHandler } from './types';
import type { ObservabilityAIAssistantChatService } from '../../types';
import type { TelemetryEventTypeWithPayload } from '../../analytics';
import { ChatItem } from './chat_item';
import { ChatConsolidatedItems } from './chat_consolidated_items';
import { ChatState } from '../../hooks/use_chat';
import {
  getTimelineItemsfromConversation,
  StartedFrom,
} from '../../utils/get_timeline_items_from_conversation';

export interface ChatTimelineItem
  extends Pick<Message['message'], 'role' | 'content' | 'function_call'> {
  id: string;
  title: ReactNode;
  actions: {
    canCopy: boolean;
    canEdit: boolean;
    canGiveFeedback: boolean;
    canRegenerate: boolean;
  };
  display: {
    collapsed: boolean;
    hide?: boolean;
  };
  loading: boolean;
  element?: React.ReactNode;
  currentUser?: Pick<AuthenticatedUser, 'username' | 'full_name'>;
  error?: any;
  message: Message;
  functionCall?: Message['message']['function_call'];
}

export interface ChatTimelineProps {
  messages: Message[];
  knowledgeBase: UseKnowledgeBaseResult;
  chatService: ObservabilityAIAssistantChatService;
  hasConnector: boolean;
  chatState: ChatState;
  currentUser?: Pick<AuthenticatedUser, 'full_name' | 'username'>;
  startedFrom?: StartedFrom;
  chatFlyoutSecondSlotHandler?: ChatFlyoutSecondSlotHandler;
  onEdit: (message: Message, messageAfterEdit: Message) => void;
  onFeedback: (message: Message, feedback: Feedback) => void;
  onRegenerate: (message: Message) => void;
  onSendTelemetry: (eventWithPayload: TelemetryEventTypeWithPayload) => void;
  onStopGenerating: () => void;
  onActionClick: ChatActionClickHandler;
}

export function ChatTimeline({
  messages,
  chatService,
  hasConnector,
  currentUser,
  startedFrom,
  chatFlyoutSecondSlotHandler,
  onEdit,
  onFeedback,
  onRegenerate,
  onSendTelemetry,
  onStopGenerating,
  onActionClick,
  chatState,
}: ChatTimelineProps) {
  const items = useMemo(() => {
    const timelineItems = getTimelineItemsfromConversation({
      chatService,
      hasConnector,
      messages,
      currentUser,
      startedFrom,
      chatState,
      chatFlyoutSecondSlotHandler,
      onActionClick,
    });

    const consolidatedChatItems: Array<ChatTimelineItem | ChatTimelineItem[]> = [];
    let currentGroup: ChatTimelineItem[] | null = null;

    for (const item of timelineItems) {
      if (item.display.hide || !item) continue;

      if (item.display.collapsed) {
        if (currentGroup) {
          currentGroup.push(item);
        } else {
          currentGroup = [item];
          consolidatedChatItems.push(currentGroup);
        }
      } else {
        consolidatedChatItems.push(item);
        currentGroup = null;
      }
    }

    return consolidatedChatItems;
  }, [
    chatService,
    hasConnector,
    messages,
    currentUser,
    startedFrom,
    chatState,
    chatFlyoutSecondSlotHandler,
    onActionClick,
  ]);

  return (
    <EuiCommentList
      className={css`
        padding-bottom: 32px;
      `}
    >
      {items.map((item, index) => {
        return Array.isArray(item) ? (
          <ChatConsolidatedItems
            key={index}
            consolidatedItem={item}
            onActionClick={onActionClick}
            onEditSubmit={onEdit}
            onFeedback={onFeedback}
            onRegenerate={onRegenerate}
            onSendTelemetry={onSendTelemetry}
            onStopGenerating={onStopGenerating}
          />
        ) : (
          <ChatItem
            // use index, not id to prevent unmounting of component when message is persisted
            key={index}
            {...omit(item, 'message')}
            onActionClick={onActionClick}
            onFeedbackClick={(feedback) => {
              onFeedback(item.message, feedback);
            }}
            onRegenerateClick={() => {
              onRegenerate(item.message);
            }}
            onEditSubmit={(message) => {
              onEdit(item.message, message);
            }}
            onSendTelemetry={onSendTelemetry}
            onStopGeneratingClick={onStopGenerating}
          />
        );
      })}
    </EuiCommentList>
  );
}
