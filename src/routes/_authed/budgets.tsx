import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { m } from "#/paraglide/messages";
import { formatMinor, formatMoney, parseAmountToMinor } from "#/lib/money";
import { useHydrated } from "#/lib/use-hydrated";
import { EditButton, DeleteButton } from "#/components/ui/action-buttons";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Select, SelectItem } from "#/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "#/components/ui/alert-dialog";
import { getCategories } from "#/server/categories.functions";
import {
  getBudgetOverview,
  createBudget,
  updateBudgetLimit,
  deleteBudget,
} from "#/server/budgets.functions";

type BudgetOverview = Awaited<ReturnType<typeof getBudgetOverview>>;
type BudgetStatus = BudgetOverview["budgets"][number];
type CategoryRow = Awaited<ReturnType<typeof getCategories>>[number];

export const Route = createFileRoute("/_authed/budgets")({
  component: BudgetsPage,
});

// Prefix of every budgets query key — transaction and import mutations
// invalidate ["budgets"] too so totals never go stale.
const BUDGETS_QUERY_KEY = ["budgets"] as const;
const CATEGORIES_QUERY_KEY = ["categories"] as const;

/** Current Budget month (`YYYY-MM`) in the browser's local time. */
function currentLocalMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function formatMonthLabel(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return new Date(year, mon - 1, 1).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

/** Categories in tree order with their depth, for the indented picker. */
function flattenCategoryTree(
  categories: CategoryRow[],
): { category: CategoryRow; depth: number }[] {
  const byParent = new Map<string | null, CategoryRow[]>();
  const ids = new Set(categories.map((c) => c.id));
  for (const cat of categories) {
    // Orphans (parent missing) are shown at the top level.
    const parent = cat.parent_id && ids.has(cat.parent_id) ? cat.parent_id : null;
    byParent.set(parent, [...(byParent.get(parent) ?? []), cat]);
  }
  const result: { category: CategoryRow; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    const children = [...(byParent.get(parentId) ?? [])].sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0),
    );
    for (const child of children) {
      result.push({ category: child, depth });
      visit(child.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}

// --- Budget Card ---

function BudgetCard({
  budget,
  onEdit,
  onDelete,
}: {
  budget: BudgetStatus;
  onEdit: (budget: BudgetStatus) => void;
  onDelete: (budget: BudgetStatus) => void;
}) {
  const barWidth = Math.min(100, budget.percentUsed);

  return (
    <div className="island-shell rounded-xl p-4 space-y-3" data-testid="budget-card">
      <div className="flex items-center gap-3">
        <span
          className="size-3 shrink-0 rounded-full border border-border/50"
          style={{ backgroundColor: budget.categoryColor ?? "#6b7280" }}
          aria-hidden="true"
        />
        <h2 className="flex-1 text-sm font-semibold truncate">
          {budget.categoryName}
          <span className="ml-2 text-xs font-normal text-muted-foreground">{budget.currency}</span>
        </h2>
        {budget.isOverBudget && (
          <Badge variant="destructive">
            <svg
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m0 3.75h.008v.008H12v-.008zM10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
              />
            </svg>
            {m.budget_over_badge()}
          </Badge>
        )}
        <div className="flex items-center gap-1">
          <EditButton onClick={() => onEdit(budget)} data-testid="edit-budget" />
          <DeleteButton onClick={() => onDelete(budget)} data-testid="delete-budget" />
        </div>
      </div>

      <div
        role="progressbar"
        aria-label={m.budget_progress_label({ name: budget.categoryName })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={barWidth}
        className="h-2 w-full rounded-full bg-muted overflow-hidden"
      >
        <div
          className={budget.isOverBudget ? "h-full bg-destructive" : "h-full bg-primary"}
          style={{ width: `${barWidth}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-sm tabular-nums">
        <span data-testid="budget-spent">
          {m.budget_spent_of_limit({
            spent: formatMoney(budget.spentMinor, budget.currency),
            limit: formatMoney(budget.limitMinor, budget.currency),
          })}
        </span>
        <span
          data-testid="budget-remaining"
          className={budget.isOverBudget ? "font-medium text-destructive" : "text-muted-foreground"}
        >
          {budget.isOverBudget
            ? m.budget_over({
                amount: formatMoney(budget.overMinor, budget.currency),
              })
            : m.budget_left({
                amount: formatMoney(budget.remainingMinor, budget.currency),
              })}
        </span>
      </div>
    </div>
  );
}

// --- Budget Form ---

interface BudgetFormData {
  categoryId: string;
  currency: string;
  limitMinor: number;
}

function BudgetForm({
  isOpen,
  editingBudget,
  categories,
  currencies,
  onClose,
  onSubmit,
  error,
}: {
  isOpen: boolean;
  /** Set when editing: only the limit can change. */
  editingBudget: BudgetStatus | null;
  categories: CategoryRow[];
  currencies: string[];
  onClose: () => void;
  onSubmit: (data: BudgetFormData) => Promise<void>;
  error: string | null;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [currency, setCurrency] = useState("");
  const [limit, setLimit] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setCategoryId(editingBudget?.categoryId ?? "");
      setCurrency(editingBudget?.currency ?? currencies[0] ?? "");
      setLimit(editingBudget ? formatMinor(editingBudget.limitMinor) : "");
      setValidationError(null);
      setSubmitting(false);
    }
  }, [isOpen, editingBudget, currencies]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryId) {
      setValidationError(m.budget_category_required());
      return;
    }
    const limitMinor = parseAmountToMinor(limit);
    // Upper bound mirrors the server schema (32-bit integer column).
    if (limitMinor === null || limitMinor <= 0 || limitMinor > 2_147_483_647) {
      setValidationError(m.budget_limit_invalid());
      return;
    }
    setValidationError(null);
    setSubmitting(true);
    try {
      await onSubmit({ categoryId, currency, limitMinor });
    } finally {
      setSubmitting(false);
    }
  };

  const options = flattenCategoryTree(categories);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editingBudget ? m.edit_budget_title() : m.new_budget_title()}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          {editingBudget ? (
            <>
              <div>
                <Label htmlFor="budget-category" className="mb-1">
                  {m.category_label()}
                </Label>
                <Input id="budget-category" value={editingBudget.categoryName} readOnly disabled />
              </div>
              <div>
                <Label htmlFor="budget-currency" className="mb-1">
                  {m.currency_label()}
                </Label>
                <Input id="budget-currency" value={editingBudget.currency} readOnly disabled />
              </div>
            </>
          ) : (
            <>
              <div>
                <Label htmlFor="budget-category" className="mb-1">
                  {m.category_label()}
                </Label>
                <Select
                  id="budget-category"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <SelectItem value="">{m.budget_category_required()}</SelectItem>
                  {options.map(({ category, depth }) => (
                    <SelectItem key={category.id} value={category.id}>
                      {"—".repeat(depth)} {category.name}
                    </SelectItem>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="budget-currency" className="mb-1">
                  {m.currency_label()}
                </Label>
                <Select
                  id="budget-currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {currencies.map((code) => (
                    <SelectItem key={code} value={code}>
                      {code}
                    </SelectItem>
                  ))}
                </Select>
              </div>
            </>
          )}

          <div>
            <Label htmlFor="budget-limit" className="mb-1">
              {m.budget_limit_label()}
            </Label>
            <Input
              id="budget-limit"
              type="text"
              inputMode="decimal"
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              placeholder="1000.00"
            />
          </div>

          {(validationError ?? error) && (
            <div className="text-destructive text-sm" role="alert">
              {validationError ?? error}
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              {m.cancel()}
            </Button>
            <Button type="submit" disabled={submitting}>
              {editingBudget
                ? submitting
                  ? m.saving()
                  : m.save_changes()
                : submitting
                  ? m.creating()
                  : m.create_budget_btn()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// --- Delete Confirmation ---

function DeleteBudgetConfirm({
  budget,
  error,
  onConfirm,
  onCancel,
}: {
  budget: BudgetStatus | null;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={!!budget} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="sm:max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle>{m.delete_budget_title()}</AlertDialogTitle>
          <AlertDialogDescription>
            {budget &&
              m.delete_budget_confirm({
                name: budget.categoryName,
                currency: budget.currency,
              })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <div className="text-destructive text-sm p-3 rounded-md bg-destructive/10" role="alert">
            {error}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{m.cancel()}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={(e) => {
              // Radix closes on click; stay open until the delete settles so
              // a failure can be shown here.
              e.preventDefault();
              onConfirm();
            }}
          >
            {m.delete()}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- Main Page ---

function BudgetsPage() {
  const hydrated = useHydrated();
  // Computed only after hydration: the server has no idea what month it is
  // for this user, and rendering it during SSR would mismatch.
  const month = hydrated ? currentLocalMonth() : null;

  const queryClient = useQueryClient();
  const getBudgetOverviewFn = useServerFn(getBudgetOverview);
  const createBudgetFn = useServerFn(createBudget);
  const updateBudgetLimitFn = useServerFn(updateBudgetLimit);
  const deleteBudgetFn = useServerFn(deleteBudget);
  const getCategoriesFn = useServerFn(getCategories);

  const { data: overview, isLoading } = useQuery({
    queryKey: [...BUDGETS_QUERY_KEY, month],
    queryFn: () => getBudgetOverviewFn({ data: { month: month! } }),
    enabled: month !== null,
    refetchOnMount: true,
    staleTime: 0,
  });

  const { data: categories = [] } = useQuery({
    queryKey: CATEGORIES_QUERY_KEY,
    queryFn: () => getCategoriesFn(),
  });

  const createMutation = useMutation({
    mutationFn: (data: BudgetFormData) => createBudgetFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BUDGETS_QUERY_KEY });
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; limitMinor: number }) => updateBudgetLimitFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BUDGETS_QUERY_KEY });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (data: { id: string }) => deleteBudgetFn({ data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BUDGETS_QUERY_KEY });
    },
  });

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetStatus | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<BudgetStatus | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleAdd = () => {
    setEditingBudget(null);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleEdit = (budget: BudgetStatus) => {
    setEditingBudget(budget);
    setFormError(null);
    setIsFormOpen(true);
  };

  const closeForm = () => {
    setIsFormOpen(false);
    setEditingBudget(null);
    setFormError(null);
  };

  const handleFormSubmit = async (data: BudgetFormData) => {
    setFormError(null);
    try {
      if (editingBudget) {
        const result = await updateMutation.mutateAsync({
          id: editingBudget.id,
          limitMinor: data.limitMinor,
        });
        if ("error" in result) {
          // Deleted elsewhere: say so, and drop the stale card from the list.
          setFormError(m.budget_not_found());
          queryClient.invalidateQueries({ queryKey: BUDGETS_QUERY_KEY });
          return;
        }
      } else {
        const result = await createMutation.mutateAsync(data);
        if ("error" in result) {
          setFormError(
            result.code === "budget_duplicate"
              ? m.budget_duplicate()
              : m.budget_category_not_found(),
          );
          return;
        }
      }
      closeForm();
    } catch {
      setFormError(m.budget_save_failed());
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setDeleteError(null);
    try {
      // A not-found result means it's already gone (e.g. deleted in another
      // tab); onSuccess refetches either way, so both outcomes just close.
      await deleteMutation.mutateAsync({ id: deleteTarget.id });
      setDeleteTarget(null);
    } catch {
      setDeleteError(m.budget_delete_failed());
    }
  };

  const budgets = overview?.budgets ?? [];

  return (
    <div className="min-h-screen">
      <header className="border-b border-line/50 bg-header-bg/80 backdrop-blur-sm">
        <div className="page-wrap py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold display-title">{m.budgets_title()}</h1>
            {month && (
              <p className="text-sm text-muted-foreground mt-0.5">
                {m.budgets_subtitle({ month: formatMonthLabel(month) })}
              </p>
            )}
          </div>
          <Button onClick={handleAdd} disabled={!overview}>
            <svg
              className="size-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            {m.add_budget()}
          </Button>
        </div>
      </header>

      <main className="page-wrap py-8">
        {overview && !overview.alertsEnabled && (
          <p
            role="note"
            className="mb-6 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
            data-testid="budget-alerts-hint"
          >
            {m.budget_alerts_verify_hint()}
          </p>
        )}
        {isLoading || !overview ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <div className="size-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-muted-foreground">{m.loading()}</span>
            </div>
          </div>
        ) : budgets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <h2 className="text-base font-medium mb-1">{m.no_budgets_yet()}</h2>
            <p className="text-sm text-muted-foreground mb-4 max-w-sm">{m.create_first_budget()}</p>
            <Button variant="outline" onClick={handleAdd}>
              {m.add_budget()}
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {budgets.map((budget) => (
              <BudgetCard
                key={budget.id}
                budget={budget}
                onEdit={handleEdit}
                onDelete={(target) => {
                  setDeleteError(null);
                  setDeleteTarget(target);
                }}
              />
            ))}
          </div>
        )}
      </main>

      <BudgetForm
        isOpen={isFormOpen}
        editingBudget={editingBudget}
        categories={categories}
        currencies={overview?.currencies ?? []}
        onClose={closeForm}
        onSubmit={handleFormSubmit}
        error={formError}
      />

      <DeleteBudgetConfirm
        budget={deleteTarget}
        error={deleteError}
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
      />
    </div>
  );
}
