import React, { useEffect } from 'react';
import {
  DragDropContext,
  DropResult,
  ResponderProvided,
} from 'react-beautiful-dnd';
import { useDispatch, useSelector } from 'react-redux';
// import { AppDispatch, RootState } from 'store';
// import {
//   loadIssues,
//   updateIssueStatusAndPos,
// } from 'store/actions/issueActions';
// import { Status } from 'types/issue';
import IssueCol from './IssueCol';

export default function IssueBoard() {
  const backlogIssues = useSelector(
    (state: RootState) => state.issues?.backlog
  );
  const todoIssues = useSelector((state: RootState) => state.issues?.todo);
  const inProgressIssues = useSelector(
    (state: RootState) => state.issues?.inProgress
  );
  const doneIssues = useSelector((state: RootState) => state.issues?.done);
  const canceledIssues = useSelector(
    (state: RootState) => state.issues?.canceled
  );

  // dispatch
  const dispatch = useDispatch<AppDispatch>();
  const onDragEnd = (
    { source, destination, draggableId }: DropResult,
    provided: ResponderProvided
  ) => {
    if (!source || !destination) return;
    dispatch(
      updateIssueStatusAndPos(
        '',
        source.droppableId,
        destination.droppableId,
        source.index,
        destination.index
      )
    );
  };

  // load data
  useEffect(() => {
    dispatch(loadIssues());
  }, []);

  return (
    <DragDropContext onDragEnd={onDragEnd}>
      <div className="flex flex-1 pt-6 pl-8 overflow-scroll bg-gray-100">
        <IssueCol
          title={'Backlog'}
          status={Status.BACKLOG}
          issues={backlogIssues}
        />
        <IssueCol title={'Todo'} status={Status.TODO} issues={todoIssues} />
        <IssueCol
          title={'In Progress'}
          status={Status.IN_PROGRESS}
          issues={inProgressIssues}
        />
        <IssueCol title={'Done'} status={Status.DONE} issues={doneIssues} />
        <IssueCol
          title={'Canceled'}
          status={Status.CANCELED}
          issues={canceledIssues}
        />
      </div>
    </DragDropContext>
  );
}
