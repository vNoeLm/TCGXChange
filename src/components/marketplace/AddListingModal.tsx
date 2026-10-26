import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useExitTransition } from '../../lib/useExitTransition';
import { ListCardModal } from './ListCardModal';
import { CreateTradeModal } from './CreateTradeModal';
import { CreateBulkModal } from './CreateBulkModal';
import type { CatalogCard, InventoryCard } from '../../types';

export type AddListingTab = 'single' | 'trade' | 'bulk' | 'auction';

export interface AddListingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: AddListingTab;
  onSuccess?: (type?: 'single' | 'trade' | 'bulk' | 'auction') => void;
  initialCard?: CatalogCard | InventoryCard | null;
}

const TABS: { id: 'single' | 'trade' | 'bulk'; label: string; description: string }[] = [
  { id: 'single', label: 'Single Card', description: 'Fixed price sale or auction' },
  { id: 'trade', label: 'Trade', description: 'Card-for-card offer' },
  { id: 'bulk', label: 'Bulk Lot', description: 'Fixed price lot or auction' },
];

export function AddListingModal({
  isOpen,
  onClose,
  initialTab = 'single',
  onSuccess,
  initialCard = null,
}: AddListingModalProps) {
  const [activeTab, setActiveTab] = useState<'single' | 'trade' | 'bulk'>(
    initialTab === 'auction' ? 'single' : (initialTab || 'single')
  );
  const [isInitialAuction, setIsInitialAuction] = useState<boolean>(initialTab === 'auction');
  const { rendered, state } = useExitTransition(isOpen, 220);

  useEffect(() => {
    if (isOpen) {
      if (initialTab === 'auction') {
        setActiveTab('single');
        setIsInitialAuction(true);
      } else {
        setActiveTab((initialTab as 'single' | 'trade' | 'bulk') || 'single');
        setIsInitialAuction(false);
      }
    }
  }, [isOpen, initialTab]);

  if (!rendered) return null;

  const content = (
    <div
      data-state={state}
      className="tv-overlay fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-state={state}
        onClick={(e) => e.stopPropagation()}
        className="tv-modal-panel w-full max-w-3xl rounded-3xl border shadow-2xl overflow-hidden flex flex-col my-auto max-h-[92vh]"
        style={{
          background: 'var(--bg-surface)',
          borderColor: 'var(--border)',
          color: 'var(--text-primary)',
        }}
      >
        {/* Top Header */}
        <div
          className="px-5 sm:px-6 py-4 border-b flex items-center justify-between gap-3 shrink-0"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-surface-2)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center border shadow-xs shrink-0"
              style={{
                background: 'var(--accent-muted)',
                borderColor: 'var(--accent-border, var(--accent))',
                color: 'var(--text-accent)',
              }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-black truncate" style={{ color: 'var(--text-primary)' }}>
                Add New Listing
              </h2>
              <p className="text-xs truncate" style={{ color: 'var(--text-tertiary)' }}>
                Choose listing type to publish on the marketplace
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full border flex items-center justify-center transition cursor-pointer hover:brightness-110 shrink-0"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-input)', color: 'var(--text-secondary)' }}
            aria-label="Close"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Tab Selection Bar — Unified Theme Styling */}
        <div
          className="px-4 sm:px-6 py-2.5 border-b shrink-0 flex items-center gap-1.5 sm:gap-2 overflow-x-auto no-scrollbar"
          style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-input)' }}
        >
          {TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setActiveTab(tab.id);
                  if (tab.id !== 'single') {
                    setIsInitialAuction(false);
                  }
                }}
                className={`flex-1 min-w-[120px] px-3 py-2 rounded-xl border text-xs font-bold transition cursor-pointer flex items-center justify-center gap-2 select-none ${
                  isActive
                    ? 'shadow-xs'
                    : 'hover:brightness-105'
                }`}
                style={
                  isActive
                    ? {
                        background: 'var(--accent-muted)',
                        borderColor: 'var(--accent-border, var(--accent))',
                        color: 'var(--text-accent)',
                      }
                    : {
                        background: 'transparent',
                        borderColor: 'transparent',
                        color: 'var(--text-tertiary)',
                      }
                }
              >
                {tab.id === 'single' && (
                  <svg
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: isActive ? 'var(--text-accent)' : 'currentColor' }}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
                    <circle cx="7" cy="7" r="1" />
                  </svg>
                )}
                {tab.id === 'trade' && (
                  <svg
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: isActive ? 'var(--text-accent)' : 'currentColor' }}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M7 16V4m0 0L3 8m4-4l4 4m6 4v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                )}
                {tab.id === 'bulk' && (
                  <svg
                    className="w-3.5 h-3.5 shrink-0"
                    style={{ color: isActive ? 'var(--text-accent)' : 'currentColor' }}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                    <line x1="12" y1="22.08" x2="12" y2="12" />
                  </svg>
                )}
                <span className="whitespace-nowrap">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Body */}
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {activeTab === 'single' && (
            <ListCardModal
              isOpen={isOpen}
              onClose={onClose}
              initialCard={initialCard}
              initialIsAuction={isInitialAuction}
              onSuccess={(type) => {
                onSuccess?.(type || 'single');
                onClose();
              }}
              embedded={true}
            />
          )}
          {activeTab === 'trade' && (
            <CreateTradeModal
              isOpen={isOpen}
              onClose={onClose}
              onSuccess={(type) => {
                onSuccess?.(type || 'trade');
                onClose();
              }}
              embedded={true}
            />
          )}
          {activeTab === 'bulk' && (
            <CreateBulkModal
              isOpen={isOpen}
              onClose={onClose}
              onSuccess={(type) => {
                onSuccess?.(type || 'bulk');
                onClose();
              }}
              embedded={true}
            />
          )}
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
