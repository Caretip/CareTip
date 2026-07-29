export type CustomerFeedbackSummary = {
  averageRating: number | null;
  ratingCount: number;
  feedbackCount: number;
};

export type CustomerFeedbackItem = {
  id: string;
  transactionId: string;
  employeeId: string;
  employeeName: string;
  rating: number | null;
  comment: string | null;
  tags: string[];
  customerName: string | null;
  createdAt: string;
};

export type CustomerFeedbackResponse = {
  total: number;
  items: CustomerFeedbackItem[];
  summary: CustomerFeedbackSummary;
};
