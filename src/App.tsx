/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { HashRouter, Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Companies from "./pages/Companies";
import Certificates from "./pages/Certificates";
import Macros from "./pages/Macros";
import Execution from "./pages/Execution";
import Gallery from "./pages/Gallery";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="companies" element={<Companies />} />
          <Route path="certificates" element={<Certificates />} />
          <Route path="macros" element={<Macros />} />
          <Route path="execution" element={<Execution />} />
          <Route path="gallery" element={<Gallery />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
