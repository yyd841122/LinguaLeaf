import { BrowserRouter, Route, Routes } from "react-router";
import { BookshelfPage } from "./BookshelfPage";
import { ReviewPage } from "./ReviewPage";
import { ReadingPage } from "./ReadingPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<BookshelfPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/book/:id/:chapter" element={<ReadingPage />} />
      </Routes>
    </BrowserRouter>
  );
}
