// This has to be done very early
import { attachConsole } from "tauri-plugin-log-api";
attachConsole();

import { listen } from "@tauri-apps/api/event";
import "animate.css/animate.min.css";
import Board from "./pages/Board";
import { useEffect, useState, createContext } from "react";
import { Route, Routes, BrowserRouter } from "react-router-dom";
import { cssTransition, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import List from "./pages/List";
import Issue from "./pages/Issue";
import Chat from "./pages/Chat";
import LeftMenu from "./components/LeftMenu";
import { Spinner } from "./components/Spinner";

import { ElectricProvider, initElectric, dbName, DEBUG } from "./electric";
import { Electric } from "./generated/client";

interface MenuContextInterface {
  showMenu: boolean;
  setShowMenu: (show: boolean) => void;
}

export const MenuContext = createContext(null as MenuContextInterface | null);

const slideUp = cssTransition({
  enter: "animate__animated animate__slideInUp",
  exit: "animate__animated animate__slideOutDown",
});

const App = () => {
  const [electric, setElectric] = useState<Electric>();
  const [showMenu, setShowMenu] = useState(false);
  const [synced, setSynced] = useState(false);
  const [ollamaDownloaded, setOllamaDownloaded] = useState(false);
  const [fastembedDownloaded, setFastembedDownloaded] = useState(false);

  useEffect(() => {
    const init = async () => {
      const client = await initElectric();
      setElectric(client);
      const { synced: syncedIssues } = await client.db.issue.sync();
      const { synced: syncedComments } = await client.db.comment.sync();
      await syncedIssues;
      await syncedComments;
      const timeToSync = performance.now();
      if (DEBUG) {
        console.log(`Synced in ${timeToSync}ms from page load`);
      }
      setSynced(true);
    };

    init();
  }, []);

  useEffect(() => {
    let unListenOllamaDownloaded: null | (() => void) = null;
    let unListenFastembedDownloaded: null | (() => void) = null;
    let ignore = false;

    const init = async () => {
      unListenOllamaDownloaded = await listen(
        "downloaded_ollama_model",
        (event) => {
          if (ignore) return;
          setOllamaDownloaded(true);
        }
      );
      unListenFastembedDownloaded = await listen(
        "downloading_fastembed_model",
        (event) => {
          if (ignore) return;
          setFastembedDownloaded(true);
        }
      );
      if (ignore) {
        unListenOllamaDownloaded?.();
        unListenOllamaDownloaded = null;
        unListenFastembedDownloaded?.();
        unListenFastembedDownloaded = null;
      }
    };

    init();

    return () => {
      ignore = true;
      unListenOllamaDownloaded?.();
      unListenOllamaDownloaded = null;
      unListenFastembedDownloaded?.();
      unListenFastembedDownloaded = null;
    };
  }, []);

  if (
    electric === undefined ||
    !synced ||
    !ollamaDownloaded ||
    !fastembedDownloaded
  ) {
    return (
      <div className="flex flex-col w-full h-screen mt-6 items-center opacity-50">
        <div className="text-lg font-semibold text-gray-400 mb-4">
          Loading Workspace
        </div>
        <Spinner />
        <div className="flex flex-col items-center mt-4">
          {!synced && (
            <div className="text-sm text-gray-300 mb-1">Syncing Issues...</div>
          )}
          {!ollamaDownloaded && (
            <div className="text-sm text-gray-300 mb-1">
              Downloading Ollama Model...
            </div>
          )}
          {!fastembedDownloaded && (
            <div className="text-sm text-gray-300 mb-1">
              Downloading FastEmbed Model...
            </div>
          )}
        </div>
      </div>
    );
  }

  const router = (
    <Routes>
      <Route path="/" element={<List />} />
      <Route path="/search" element={<List showSearch={true} />} />
      <Route path="/board" element={<Board />} />
      <Route path="/issue/:id" element={<Issue />} />
      <Route path="/chat" element={<Chat />} />
    </Routes>
  );

  return (
    <ElectricProvider db={electric}>
      <MenuContext.Provider value={{ showMenu, setShowMenu }}>
        <BrowserRouter>
          <div className="flex w-full h-screen overflow-y-hidden">
            <LeftMenu />
            {router}
          </div>
          <ToastContainer
            position="bottom-right"
            autoClose={5000}
            hideProgressBar
            newestOnTop
            closeOnClick
            rtl={false}
            transition={slideUp}
            pauseOnFocusLoss
            draggable
            pauseOnHover
          />
        </BrowserRouter>
      </MenuContext.Provider>
    </ElectricProvider>
  );
};

export default App;
