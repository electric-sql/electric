import Modal from '../components/Modal';
import React from 'react';

interface Props {
  isOpen: boolean;
  onDismiss?: () => void;
}

export default function InviteBox({ isOpen, onDismiss }: Props) {
  return (
    <Modal isOpen={isOpen} title="Invite people" onDismiss={onDismiss}>
      <div className="flex flex-col w-full px-8 py-6 overflow-y-auto">
        <label className="mb-4.5 text-gray-500 text-xs">
          Invite people to collaborate in Linear:
        </label>
        <input
          className="mb-4 w-full px-3 py-1.5 border-gray-300 border hover:border-gray-400 focus:border-blue-700 rounded outline-none"
          placeholder="name@example.com"
        />
        <input
          className="mb-4 w-full px-3 py-1.5 border-gray-300 border appearance-none hover:border-gray-400 focus:border-blue-700 rounded outline-none"
          placeholder="name@example.com"
        />
        <input
          className="mb-4 w-full px-3 py-1.5 border-gray-300 border hover:border-gray-400 focus:border-blue-700 rounded outline-none"
          placeholder="name@example.com"
        />

        <div className="flex items-center justify-between w-full mt-2">
          <button className="border-none outline-none focus:outline-none">
            + Add more
          </button>
          <button className="h-8 px-8 text-white bg-indigo-500 rounded hover:bg-indigo-600 focus:outline-none">
            Send Invites
          </button>
        </div>
      </div>
    </Modal>
  );
}
