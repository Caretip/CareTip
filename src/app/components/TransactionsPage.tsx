import { useState } from 'react';
import { motion } from 'motion/react';
import {
  Search,
  Download,
  ChevronDown,
  Eye,
  RefreshCw,
  CreditCard,
  Euro,
  CheckCircle2,
  Clock,
  XCircle,
  ArrowUpRight,
  ArrowDownRight,
  MoreVertical,
} from 'lucide-react';
import { formatEur } from '../lib/formatEur';

// Transaction type
interface Transaction {
  id: string;
  customer: string;
  email: string;
  amount: number;
  type: 'tip' | 'refund' | 'adjustment';
  status: 'completed' | 'pending' | 'failed';
  date: string;
  description: string;
  paymentMethod: string;
}

const getStatusConfig = (status: Transaction['status']) => {
  switch (status) {
    case 'completed':
      return {
        icon: CheckCircle2,
        label: 'Completed',
        className: 'border border-primary/20 bg-success text-success-foreground',
        iconClassName: 'text-primary',
      };
    case 'pending':
      return {
        icon: Clock,
        label: 'Pending',
        className: 'bg-gray-50 text-neutral-600 border-gray-200 dark:bg-neutral-900 dark:text-neutral-400 dark:border-neutral-800',
        iconClassName: 'text-neutral-600 dark:text-neutral-400',
      };
    case 'failed':
      return {
        icon: XCircle,
        label: 'Failed',
        className: 'bg-gray-50 text-neutral-600 border-gray-200 dark:bg-neutral-900 dark:text-neutral-400 dark:border-neutral-800',
        iconClassName: 'text-neutral-600 dark:text-neutral-400',
      };
  }
};

const getTypeConfig = (type: Transaction['type']) => {
  switch (type) {
    case 'tip':
      return { icon: CreditCard, color: 'text-accent' };
    case 'refund':
      return { icon: ArrowDownRight, color: 'text-primary' };
    case 'adjustment':
      return { icon: ArrowUpRight, color: 'text-neutral-600 dark:text-neutral-400' };
  }
};

export function TransactionsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [selectedDateRange, setSelectedDateRange] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [_viewMode, _setViewMode] = useState<'table' | 'cards'>('table');
  const [transactions] = useState<Transaction[]>([]);
  const itemsPerPage = 5;

  // Filter transactions
  const filteredTransactions = transactions.filter((transaction) => {
    const matchesSearch =
      transaction.customer.toLowerCase().includes(searchQuery.toLowerCase()) ||
      transaction.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      transaction.id.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesStatus = selectedStatus === 'all' || transaction.status === selectedStatus;
    const matchesType = selectedType === 'all' || transaction.type === selectedType;
    
    return matchesSearch && matchesStatus && matchesType;
  });

  // Pagination
  const totalPages = Math.ceil(filteredTransactions.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentTransactions = filteredTransactions.slice(startIndex, endIndex);

  // Calculate stats
  const totalAmount = filteredTransactions
    .filter(t => t.status === 'completed' && t.type !== 'refund')
    .reduce((sum, t) => sum + t.amount, 0);
  
  const completedCount = filteredTransactions.filter(t => t.status === 'completed').length;
  const pendingCount = filteredTransactions.filter(t => t.status === 'pending').length;
  const failedCount = filteredTransactions.filter(t => t.status === 'failed').length;

  return (
    <main className="bg-background px-4 py-8 pb-20 lg:px-8">
            {/* Page Header */}
            <div className="mb-8">
              <h1 className="text-2xl sm:text-3xl font-semibold text-foreground mb-2">
                Transactions & Activity
              </h1>
              <p className="text-muted-foreground">
                Every row is a one-time tip or related movement, with no recurring subscriptions
              </p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="bg-card border border-border rounded-xl p-6"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Tip volume</span>
                  <Euro className="w-5 h-5 text-accent" />
                </div>
                <p className="text-2xl font-semibold text-foreground">{formatEur(totalAmount)}</p>
                <p className="mt-1 text-xs text-primary">+12.5% from last month</p>
              </motion.div>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.15 }}
                className="bg-card border border-border rounded-xl p-6"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Completed</span>
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                </div>
                <p className="text-2xl font-semibold text-foreground">{completedCount}</p>
                <p className="text-xs text-muted-foreground mt-1">Successful transactions</p>
              </motion.div>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="bg-card border border-border rounded-xl p-6"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Pending</span>
                  <Clock className="w-5 h-5 text-yellow-600" />
                </div>
                <p className="text-2xl font-semibold text-foreground">{pendingCount}</p>
                <p className="text-xs text-muted-foreground mt-1">Awaiting processing</p>
              </motion.div>

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.25 }}
                className="bg-card border border-border rounded-xl p-6"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">Failed</span>
                  <XCircle className="w-5 h-5 text-red-600" />
                </div>
                <p className="text-2xl font-semibold text-foreground">{failedCount}</p>
                <p className="text-xs text-muted-foreground mt-1">Requires attention</p>
              </motion.div>
            </div>

            {/* Filters and Search */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="bg-card border border-border rounded-xl p-6 mb-6"
            >
              <div className="flex flex-col lg:flex-row gap-4">
                {/* Search Bar */}
                <div className="flex-1">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search by customer, email, or transaction ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-11 pr-4 py-3 bg-input-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all"
                    />
                  </div>
                </div>

                {/* Filters */}
                <div className="flex flex-wrap gap-3">
                  {/* Status Filter */}
                  <div className="relative">
                    <select
                      aria-label="All Status"
                      value={selectedStatus}
                      onChange={(e) => setSelectedStatus(e.target.value)}
                      className="appearance-none pl-4 pr-10 py-3 bg-input-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all cursor-pointer text-sm"
                    >
                      <option value="all">All Status</option>
                      <option value="completed">Completed</option>
                      <option value="pending">Pending</option>
                      <option value="failed">Failed</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  </div>

                  {/* Type Filter */}
                  <div className="relative">
                    <select
                      aria-label="All Types"
                      value={selectedType}
                      onChange={(e) => setSelectedType(e.target.value)}
                      className="appearance-none pl-4 pr-10 py-3 bg-input-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all cursor-pointer text-sm"
                    >
                      <option value="all">All Types</option>
                      <option value="tip">Tip</option>
                      <option value="refund">Refund</option>
                      <option value="adjustment">Adjustment</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  </div>

                  {/* Date Range Filter */}
                  <div className="relative">
                    <select
                      aria-label="All Time"
                      value={selectedDateRange}
                      onChange={(e) => setSelectedDateRange(e.target.value)}
                      className="appearance-none pl-4 pr-10 py-3 bg-input-background border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent transition-all cursor-pointer text-sm"
                    >
                      <option value="all">All Time</option>
                      <option value="today">Today</option>
                      <option value="week">This Week</option>
                      <option value="month">This Month</option>
                      <option value="quarter">This Quarter</option>
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  </div>

                  {/* Export Button */}
                  <button
                    type="button"
                    aria-label="Export"
                    className="flex touch-manipulation items-center gap-2 rounded-lg bg-accent px-4 py-3 text-sm font-medium text-white transition-[colors,opacity,box-shadow] hover:bg-accent/90 active:opacity-90"
                  >
                    <Download className="w-4 h-4" />
                    <span className="hidden sm:inline">Export</span>
                  </button>
                </div>
              </div>
            </motion.div>

            {/* Transactions Table (Desktop) */}
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="bg-card border border-border rounded-xl overflow-hidden hidden lg:block"
            >
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Transaction ID
                      </th>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Customer
                      </th>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Type
                      </th>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Status
                      </th>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Date
                      </th>
                      <th className="text-right px-6 py-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {currentTransactions.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
                          <CreditCard className="w-12 h-12 mx-auto mb-4 opacity-50" />
                          <p className="font-medium">No transactions yet</p>
                          <p className="text-sm mt-1">Transactions will appear here when payment data is connected.</p>
                        </td>
                      </tr>
                    ) : (
                    currentTransactions.map((transaction, index) => {
                      const statusConfig = getStatusConfig(transaction.status);
                      const typeConfig = getTypeConfig(transaction.type);
                      const StatusIcon = statusConfig.icon;
                      const TypeIcon = typeConfig.icon;

                      return (
                        <motion.tr
                          key={transaction.id}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.3, delay: index * 0.05 }}
                          className="hover:bg-muted/30 transition-colors"
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <TypeIcon className={`w-4 h-4 ${typeConfig.color}`} />
                              <span className="text-sm font-medium text-foreground">
                                {transaction.id}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {transaction.customer}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {transaction.email}
                              </p>
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-sm text-foreground capitalize">
                              {transaction.type.replace('-', ' ')}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-sm font-semibold text-foreground">{formatEur(transaction.amount)}</span>
                          </td>
                          <td className="px-6 py-4">
                            <span
                              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${statusConfig.className}`}
                            >
                              <StatusIcon className="w-3.5 h-3.5" />
                              {statusConfig.label}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <span className="text-sm text-muted-foreground">
                              {new Date(transaction.date).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                              })}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                type="button"
                                className="touch-manipulation rounded-lg p-2 transition-colors hover:bg-muted active:opacity-90"
                                title="View Details"
                              >
                                <Eye className="w-4 h-4 text-muted-foreground" />
                              </button>
                              {transaction.status === 'completed' && (
                                <button
                                  type="button"
                                  className="touch-manipulation rounded-lg p-2 transition-colors hover:bg-muted active:opacity-90"
                                  title="View in Stripe"
                                >
                                  <RefreshCw className="w-4 h-4 text-muted-foreground" />
                                </button>
                              )}
                              <button
                                type="button"
                                className="touch-manipulation rounded-lg p-2 transition-colors hover:bg-muted active:opacity-90"
                              >
                                <MoreVertical className="w-4 h-4 text-muted-foreground" />
                              </button>
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>

            {/* Transactions Cards (Mobile) */}
            <div className="lg:hidden space-y-4">
              {currentTransactions.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground">
                  <CreditCard className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">No transactions yet</p>
                </div>
              ) : (
              currentTransactions.map((transaction, index) => {
                const statusConfig = getStatusConfig(transaction.status);
                const typeConfig = getTypeConfig(transaction.type);
                const StatusIcon = statusConfig.icon;
                const TypeIcon = typeConfig.icon;

                return (
                  <motion.div
                    key={transaction.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    className="bg-card border border-border rounded-xl p-5"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <TypeIcon className={`w-5 h-5 ${typeConfig.color}`} />
                        <span className="text-sm font-semibold text-foreground">
                          {transaction.id}
                        </span>
                      </div>
                      <span
                        className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${statusConfig.className}`}
                      >
                        <StatusIcon className="w-3.5 h-3.5" />
                        {statusConfig.label}
                      </span>
                    </div>

                    {/* Customer Info */}
                    <div className="mb-4">
                      <p className="text-sm font-medium text-foreground mb-1">
                        {transaction.customer}
                      </p>
                      <p className="text-xs text-muted-foreground mb-2">
                        {transaction.email}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {transaction.description}
                      </p>
                    </div>

                    {/* Details */}
                    <div className="flex items-center justify-between mb-4 pb-4 border-b border-border">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Amount</p>
                        <p className="text-lg font-semibold text-foreground">{formatEur(transaction.amount)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-muted-foreground mb-1">Date</p>
                        <p className="text-sm text-foreground">
                          {new Date(transaction.date).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="flex flex-1 touch-manipulation items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-muted active:opacity-90"
                      >
                        <Eye className="w-4 h-4" />
                        View Details
                      </button>
                      {transaction.status === 'completed' && (
                        <button
                          type="button"
                          className="flex flex-1 touch-manipulation items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm text-white transition-colors hover:bg-accent/90 active:opacity-90"
                        >
                          <RefreshCw className="w-4 h-4" />
                          Repeat
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })
              )}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.5, delay: 0.5 }}
                className="flex items-center justify-between mt-6"
              >
                <p className="text-sm text-muted-foreground">
                  Showing {startIndex + 1} to {Math.min(endIndex, filteredTransactions.length)} of{' '}
                  {filteredTransactions.length} transactions
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                    className="touch-manipulation rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                    <button
                      key={page}
                      type="button"
                      onClick={() => setCurrentPage(page)}
                      className={`touch-manipulation rounded-lg px-4 py-2 transition-colors active:opacity-90 ${
                        currentPage === page
                          ? 'bg-accent text-white'
                          : 'border border-border hover:bg-muted'
                      }`}
                    >
                      {page}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="touch-manipulation rounded-lg border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted active:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </motion.div>
            )}
    </main>
  );
}
