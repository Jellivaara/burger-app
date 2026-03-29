import React, { useEffect, useRef, useState } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, onValue, push, ref, remove, update } from "firebase/database";
import { getDownloadURL, getStorage, ref as sRef, uploadBytes } from "firebase/storage";
import { DragDropContext, Draggable, Droppable } from "@hello-pangea/dnd";
import "./App.css";

const firebaseConfig = {
  apiKey: "...",
  authDomain: "burger-order-system.firebaseapp.com",
  databaseURL: "https://burger-order-system-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "burger-order-system",
  storageBucket: "burger-order-system.appspot.com",
  messagingSenderId: "965908419031",
  appId: "1:965908419031:web:6462180d142bcc0640bb92",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app);

const statusColors = {
  waiting: "#f9f871",
  cooking: "#ffd580",
  ready: "#a8ff9e",
  poydassa: "#a0d8ff",
  menneet: "#ddd",
};

const statusTitles = {
  waiting: "Odottaa",
  cooking: "Työn alla",
  ready: "Valmis",
  poydassa: "Pöydässä",
  menneet: "Menneet tilaukset",
};

const TABLE_OPTIONS = [...Array(20)].map((_, index) => String(index + 1));
const UNCATEGORIZED_ID = "__uncategorized__";
const UNCATEGORIZED_LABEL = "Tyhjä kategoria";
const CATEGORY_DRAG_HINT = "Vedä kategoriaa";
const ADMIN_TOOL_PANELS = ["menu-list", "daily-sales"];
const ADMIN_PANEL_TITLES = {
  "menu-list": "Ruokalista",
  "daily-sales": "Päivän myynti",
};

function groupOrderItems(items = []) {
  const groupedItems = {};

  items.forEach((item) => {
    const key = `${item.meal}___${item.notes || ""}`;
    if (!groupedItems[key]) {
      groupedItems[key] = { ...item };
    } else {
      groupedItems[key].qty += item.qty;
    }
  });

  return Object.values(groupedItems);
}

function summarizeOrderChanges(previousItems = [], nextItems = []) {
  const previousGrouped = new Map();
  const nextGrouped = new Map();

  groupOrderItems(previousItems).forEach((item) => {
    previousGrouped.set(`${item.meal}___${item.notes || ""}`, item);
  });

  groupOrderItems(nextItems).forEach((item) => {
    nextGrouped.set(`${item.meal}___${item.notes || ""}`, item);
  });

  const allKeys = new Set([...previousGrouped.keys(), ...nextGrouped.keys()]);
  const summary = { added: [], removed: [], changed: [] };

  allKeys.forEach((key) => {
    const previousItem = previousGrouped.get(key);
    const nextItem = nextGrouped.get(key);

    if (!previousItem && nextItem) {
      summary.added.push({
        meal: nextItem.meal,
        notes: nextItem.notes || "",
        qty: nextItem.qty,
      });
      return;
    }

    if (previousItem && !nextItem) {
      summary.removed.push({
        meal: previousItem.meal,
        notes: previousItem.notes || "",
        qty: previousItem.qty,
      });
      return;
    }

    if (previousItem && nextItem && previousItem.qty !== nextItem.qty) {
      summary.changed.push({
        meal: nextItem.meal,
        notes: nextItem.notes || "",
        fromQty: previousItem.qty,
        toQty: nextItem.qty,
      });
    }
  });

  return summary;
}

function hasOrderChanges(summary) {
  return Boolean(
    summary &&
      ((summary.added && summary.added.length > 0) ||
        (summary.removed && summary.removed.length > 0) ||
        (summary.changed && summary.changed.length > 0))
  );
}

function normalizeCategoryId(categoryId) {
  return categoryId || UNCATEGORIZED_ID;
}

function isSameLocalDay(timestamp, reference = Date.now()) {
  const target = new Date(timestamp);
  const current = new Date(reference);
  return (
    target.getFullYear() === current.getFullYear() &&
    target.getMonth() === current.getMonth() &&
    target.getDate() === current.getDate()
  );
}

function buildCategoryGroups(menu, categories, categoryOrder = [], includeEmpty = false) {
  const categoryMap = new Map(categories.map((category) => [category.id, category]));
  const baseCategories = [
    ...categories.map((category) => ({
      id: category.id,
      name: category.name,
    })),
    { id: UNCATEGORIZED_ID, name: UNCATEGORIZED_LABEL },
  ];

  const preferredOrder = categoryOrder.length > 0 ? categoryOrder : baseCategories.map((category) => category.id);
  const orderedCategories = [
    ...preferredOrder
      .map((id) =>
        id === UNCATEGORIZED_ID
          ? { id: UNCATEGORIZED_ID, name: UNCATEGORIZED_LABEL }
          : categoryMap.has(id)
            ? { id, name: categoryMap.get(id).name }
            : null
      )
      .filter(Boolean),
    ...baseCategories.filter((category) => !preferredOrder.includes(category.id)),
  ];

  return orderedCategories
    .map((category) => ({
      ...category,
      items: menu
        .filter((meal) => normalizeCategoryId(meal.categoryId) === category.id)
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0)),
    }))
    .filter((category) => includeEmpty || category.items.length > 0);
}

function ScreenHeader({ title, subtitle }) {
  const [currentTime, setCurrentTime] = useState(() =>
    new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCurrentTime(
        new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hour12: false,
        })
      );
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <div className="screen-header">
      <div>
        <h1 className="screen-title">{title}</h1>
        {subtitle ? <p className="screen-subtitle">{subtitle}</p> : null}
      </div>
      <div className="screen-clock" aria-label="Nykyinen kellonaika">
        {currentTime}
      </div>
    </div>
  );
}

function Navigation({ view, setView }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const handleSelect = (nextView) => {
    setView(nextView);
    setOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="topbar">
      <div ref={containerRef} className="nav-menu">
        <button className="nav-trigger" onClick={() => setOpen((current) => !current)}>
          {view} ▼
        </button>
        {open ? (
          <div className="nav-dropdown">
            {["Kassa", "Keittiö", "Admin"].map((option) => (
              <button
                key={option}
                className={`nav-option${view === option ? " is-active" : ""}`}
                onClick={() => handleSelect(option)}
              >
                {option}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

const useAdminPassword = () => {
  const [password, setPassword] = useState(null);

  useEffect(() => {
    onValue(ref(db, "settings/adminPassword"), (snapshot) => {
      setPassword(snapshot.val() || null);
    });
  }, []);

  return password;
};

function CashierApp({ menu, categories }) {
  const [table, setTable] = useState("1");
  const [currentOrder, setCurrentOrder] = useState([]);
  const [orders, setOrders] = useState([]);
  const [pastOrders, setPastOrders] = useState([]);
  const [editingOrders, setEditingOrders] = useState({});
  const [newOrderMode, setNewOrderMode] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [menuCategoryOrder, setMenuCategoryOrder] = useState([]);
  const [mealSearch, setMealSearch] = useState("");
  const [showCategories, setShowCategories] = useState(false);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState({});
  const editRef = useRef(null);

  useEffect(() => {
    onValue(ref(db, "orders"), (snapshot) => {
      const data = snapshot.val() || {};
      const nextOrders = Object.entries(data).map(([id, value]) => ({ id, ...value }));
      const inactiveStatuses = ["paid", "closed", "menneet"];
      const occupiedTables = nextOrders
        .filter((order) => !inactiveStatuses.includes(order.status))
        .map((order) => order.table);

      setOrders(nextOrders);
      setTable((previous) => {
        if (newOrderMode || !occupiedTables.includes(previous)) {
          return previous;
        }

        return TABLE_OPTIONS.find((candidate) => !occupiedTables.includes(candidate)) || previous;
      });
    });
  }, [newOrderMode]);

  useEffect(() => {
    onValue(ref(db, "pastOrders"), (snapshot) => {
      const data = snapshot.val() || {};
      setPastOrders(Object.entries(data).map(([id, value]) => ({ id, ...value })));
    });
  }, []);

  const inactiveStatuses = ["paid", "closed", "menneet"];
  const activeTables = orders
    .filter((order) => !inactiveStatuses.includes(order.status))
    .map((order) => order.table);
  const availableTables = TABLE_OPTIONS.filter((candidate) => !activeTables.includes(candidate) || candidate === table);
  const checkTableAvailable = () =>
    !orders.find((order) => order.table === table && !inactiveStatuses.includes(order.status));
  const getNextAvailableTable = (preferredTable = null) => {
    const candidateTables = preferredTable ? [preferredTable, ...TABLE_OPTIONS] : TABLE_OPTIONS;
    return candidateTables.find(
      (candidate, index) =>
        candidate &&
        candidateTables.indexOf(candidate) === index &&
        !activeTables.includes(candidate)
    );
  };

  useEffect(() => {
    const availableCategoryIds = [
      ...categories.map((category) => category.id),
      UNCATEGORIZED_ID,
    ];

    setMenuCategoryOrder((previous) => {
      const filtered = previous.filter((id) => availableCategoryIds.includes(id));
      const missing = availableCategoryIds.filter((id) => !filtered.includes(id));
      return [...filtered, ...missing];
    });
  }, [categories]);

  const startNewOrder = () => {
    if (!checkTableAvailable()) {
      alert("Pöytä on jo varattu aktiivisella tilauksella!");
      return;
    }

    setCurrentOrder([]);
    setNewOrderMode(true);
    setOrderChanged(false);
    setMealSearch("");
    setTimeout(() => editRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const saveOrder = () => {
    if (currentOrder.length === 0) {
      alert("Tilauksessa ei ole annoksia!");
      return;
    }

    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const data = {
      table,
      items: currentOrder,
      status: "waiting",
      updated: false,
      editSummary: null,
      createdAt: now,
      orderIndex: now,
    };

    push(ref(db, "orders"), data);
    const nextAvailableTable = getNextAvailableTable();
    setCurrentOrder([]);
    setNewOrderMode(false);
    setOrderChanged(false);
    setMealSearch("");
    if (nextAvailableTable) {
      setTable(nextAvailableTable);
    }
  };

  const cancelEdit = () => {
    setCurrentOrder([]);
    setNewOrderMode(false);
    setOrderChanged(false);
    setMealSearch("");
  };

  const createEditingState = (order) => ({
    table: order.table,
    currentOrder: order.items || [],
    orderChanged: false,
    mealSearch: "",
    showCategories: false,
    collapsedCategoryIds: {},
    menuCategoryOrder: [],
  });

  const startEditOrder = (order) => {
    if (
      ["cooking", "ready"].includes(order.status) &&
      !window.confirm(
        order.status === "cooking"
          ? "Tämä tilaus on työn alla. Haluatko varmasti muokata sitä?"
          : "Tämä tilaus on valmis vietäväksi pöytään. Haluatko varmasti muokata sitä?"
      )
    ) {
      return;
    }

    setEditingOrders((previous) => ({
      ...previous,
      [order.id]: previous[order.id] || createEditingState(order),
    }));
    setTimeout(() => editRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const addToOrderFromMenu = (mealId) => {
    const mealObj = menu.find((meal) => meal.id === mealId);
    if (!mealObj) {
      return;
    }

    setCurrentOrder((previous) => {
      setOrderChanged(true);
      return [
        ...previous,
        { mealId, meal: mealObj.name, notes: "", qty: 1, price: mealObj.price ?? null },
      ];
    });
  };

  const closeTable = (order) => {
    if (
      window.confirm(
        "Haluatko sulkea pöydän? Tämä siirtää tilauksen menneisiin tilauksiin ja vapauttaa pöydän."
      )
    ) {
      // eslint-disable-next-line react-hooks/purity
      const closedAt = Date.now();
      push(ref(db, "pastOrders"), {
        ...order,
        status: "menneet",
        closedAt,
      }).then(() => remove(ref(db, `orders/${order.id}`)));
      setTable((previous) => (previous === order.table ? "1" : previous));
    }
  };

  const categoriesDefault = ["waiting", "cooking", "ready", "poydassa", "menneet"];
  const [categoryOrder, setCategoryOrder] = useState(categoriesDefault);

  const groupedOrders = categoryOrder.reduce((accumulator, status) => {
    const sourceOrders =
      status === "menneet"
        ? [...pastOrders, ...orders.filter((order) => order.status === "menneet")]
        : orders.filter((order) => order.status === status);
    accumulator[status] = sourceOrders.sort((left, right) => (left.orderIndex || 0) - (right.orderIndex || 0));
    return accumulator;
  }, {});

  const onCategoryDragEnd = (result) => {
    if (!result.destination) {
      return;
    }

    const newOrder = Array.from(categoryOrder);
    const [removed] = newOrder.splice(result.source.index, 1);
    newOrder.splice(result.destination.index, 0, removed);
    setCategoryOrder(newOrder);
  };

  const onMenuCategoryDragEnd = (result) => {
    if (!result.destination) {
      return;
    }

    const newOrder = Array.from(menuCategoryOrder);
    const [removed] = newOrder.splice(result.source.index, 1);
    newOrder.splice(result.destination.index, 0, removed);
    setMenuCategoryOrder(newOrder);
  };

  const toggleCategoryCollapsed = (categoryId) => {
    setCollapsedCategoryIds((previous) => ({
      ...previous,
      [categoryId]: !previous[categoryId],
    }));
  };

  const normalizedMealSearch = mealSearch.trim().toLowerCase();
  const hasOpenEdits = Object.keys(editingOrders).length > 0;
  const categoryNameMap = new Map(
    categories.map((category) => [category.id, category.name.toLowerCase()])
  );
  const filteredMenu = normalizedMealSearch
    ? menu.filter((meal) => {
        const mealNameMatch = meal.name.toLowerCase().includes(normalizedMealSearch);
        const mealCategoryName =
          categoryNameMap.get(meal.categoryId || "") ||
          (normalizeCategoryId(meal.categoryId) === UNCATEGORIZED_ID ? UNCATEGORIZED_LABEL.toLowerCase() : "");
        const categoryMatch = mealCategoryName.includes(normalizedMealSearch);
        return mealNameMatch || categoryMatch;
      })
    : menu;
  const menuGroups = buildCategoryGroups(filteredMenu, categories, menuCategoryOrder).filter(
    (category) => category.items.length > 0 || !normalizedMealSearch
  );
  const uncategorizedMenuItems = filteredMenu;

  const updateEditingOrderState = (orderId, updater) => {
    setEditingOrders((previous) => {
      const existing = previous[orderId];
      if (!existing) return previous;
      const nextState = typeof updater === "function" ? updater(existing) : { ...existing, ...updater };
      return {
        ...previous,
        [orderId]: nextState,
      };
    });
  };

  const cancelEditingOrder = (orderId) => {
    setEditingOrders((previous) => {
      const next = { ...previous };
      delete next[orderId];
      return next;
    });
  };

  const saveEditingOrder = (orderId) => {
    const editState = editingOrders[orderId];
    if (!editState) return;
    if (editState.currentOrder.length === 0) {
      alert("Tilauksessa ei ole annoksia!");
      return;
    }

    const existingOrder = orders.find((order) => order.id === orderId);
    if (!existingOrder) return;

    const baselineItems =
      existingOrder.updated && Array.isArray(existingOrder.editBaseItems)
        ? existingOrder.editBaseItems
        : existingOrder.items || [];
    const editSummary = summarizeOrderChanges(baselineItems, editState.currentOrder);
    const hasChanges = hasOrderChanges(editSummary);

    const data = {
      table: editState.table,
      items: editState.currentOrder,
      status: existingOrder.status || "waiting",
      updated: hasChanges,
      editSummary: hasChanges ? editSummary : null,
      editBaseItems: hasChanges ? baselineItems : null,
      createdAt: existingOrder.createdAt,
      orderIndex: existingOrder.orderIndex,
    };

    update(ref(db, `orders/${orderId}`), data);
    cancelEditingOrder(orderId);
  };

  const deleteEditingOrder = (orderId) => {
    if (window.confirm("Oletko varma että haluat poistaa koko tilauksen? Tämä poistaa sen pysyvästi.")) {
      remove(ref(db, `orders/${orderId}`));
      cancelEditingOrder(orderId);
    }
  };

  const toggleEditingCategoryCollapsed = (orderId, categoryId) => {
    updateEditingOrderState(orderId, (existing) => ({
      ...existing,
      collapsedCategoryIds: {
        ...existing.collapsedCategoryIds,
        [categoryId]: !existing.collapsedCategoryIds[categoryId],
      },
    }));
  };

  const toggleEditingShowCategories = (orderId) => {
    updateEditingOrderState(orderId, (existing) => ({
      ...existing,
      showCategories: !existing.showCategories,
    }));
  };

  const onEditingMenuCategoryDragEnd = (orderId, result) => {
    if (!result.destination) return;
    updateEditingOrderState(orderId, (existing) => {
      const nextOrder = Array.from(existing.menuCategoryOrder);
      const [removed] = nextOrder.splice(result.source.index, 1);
      nextOrder.splice(result.destination.index, 0, removed);
      return { ...existing, menuCategoryOrder: nextOrder };
    });
  };

  const addToEditingOrderFromMenu = (orderId, mealId) => {
    const mealObj = menu.find((meal) => meal.id === mealId);
    if (!mealObj) return;
    updateEditingOrderState(orderId, (existing) => ({
      ...existing,
      orderChanged: true,
      currentOrder: [
        ...existing.currentOrder,
        { mealId, meal: mealObj.name, notes: "", qty: 1, price: mealObj.price ?? null },
      ],
    }));
  };

  const getEditingMenuData = (editState) => {
    const normalizedSearch = editState.mealSearch.trim().toLowerCase();
    const categoryNameMapLocal = new Map(
      categories.map((category) => [category.id, category.name.toLowerCase()])
    );
    const filtered = normalizedSearch
      ? menu.filter((meal) => {
          const mealNameMatch = meal.name.toLowerCase().includes(normalizedSearch);
          const mealCategoryName =
            categoryNameMapLocal.get(meal.categoryId || "") ||
            (normalizeCategoryId(meal.categoryId) === UNCATEGORIZED_ID ? UNCATEGORIZED_LABEL.toLowerCase() : "");
          return mealNameMatch || mealCategoryName.includes(normalizedSearch);
        })
      : menu;

    const availableCategoryIds = [...categories.map((category) => category.id), UNCATEGORIZED_ID];
    const filteredOrder = (editState.menuCategoryOrder || []).filter((id) => availableCategoryIds.includes(id));
    const effectiveOrder = [...filteredOrder, ...availableCategoryIds.filter((id) => !filteredOrder.includes(id))];
    const groups = buildCategoryGroups(filtered, categories, effectiveOrder).filter(
      (category) => category.items.length > 0 || !normalizedSearch
    );

    return { normalizedSearch, filtered, groups };
  };

  const renderCashierMealPicker = () => (
    <>
      <div className="field-group" style={{ marginBottom: 16 }}>
        <label>Hae annosta tai kategoriaa</label>
        <input
          className="input"
          type="text"
          placeholder="Kirjoita annoksen tai kategorian nimi..."
          value={mealSearch}
          onChange={(event) => setMealSearch(event.target.value)}
        />
      </div>
      <div className="controls-row" style={{ marginBottom: 16 }}>
        <button className="btn btn-secondary btn-small" onClick={() => setShowCategories((current) => !current)}>
          {showCategories ? "Piilota kategoriat" : "Näytä kategoriat"}
        </button>
      </div>

      {showCategories ? (
        <DragDropContext onDragEnd={onMenuCategoryDragEnd}>
          <Droppable droppableId="cashier-menu-categories" direction="vertical" type="MENU_CATEGORY">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="content-stack">
                {menuGroups.map((category, index) => (
                  <Draggable key={category.id} draggableId={category.id} index={index}>
                    {(draggableProvided) => (
                      <div
                        ref={draggableProvided.innerRef}
                        {...draggableProvided.draggableProps}
                        className="panel menu-category-panel"
                        style={draggableProvided.draggableProps.style}
                      >
                        <div
                          className="menu-category-header menu-category-drag-handle"
                          {...draggableProvided.dragHandleProps}
                        >
                          <h3 className="panel-title">{category.name}</h3>
                          <div className="controls-row">
                            <span className="menu-category-hint">{CATEGORY_DRAG_HINT}</span>
                            <button
                              className="btn btn-secondary btn-small"
                              onClick={() => toggleCategoryCollapsed(category.id)}
                            >
                              {collapsedCategoryIds[category.id] ? "Näytä kategoria" : "Piilota kategoria"}
                            </button>
                          </div>
                        </div>
                        {!collapsedCategoryIds[category.id] ? (
                          <div className="product-grid">
                            {category.items.map((meal) => (
                              <div
                                key={meal.id}
                                className="product-card clickable"
                                onClick={() => addToOrderFromMenu(meal.id)}
                              >
                                {meal.image ? (
                                  <img className="product-image" src={meal.image} alt={meal.name} />
                                ) : (
                                  <div className="product-placeholder" />
                                )}
                                <div className="product-name">{meal.name}</div>
                                {meal.price != null ? <div className="product-price">{meal.price}€</div> : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </Draggable>
                ))}
                {normalizedMealSearch && menuGroups.length === 0 ? (
                  <p className="muted">Haulla ei löytynyt annoksia.</p>
                ) : null}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      ) : (
        <div className="panel menu-category-panel">
          <div className="product-grid">
            {uncategorizedMenuItems.map((meal) => (
              <div
                key={meal.id}
                className="product-card clickable"
                onClick={() => addToOrderFromMenu(meal.id)}
              >
                {meal.image ? (
                  <img className="product-image" src={meal.image} alt={meal.name} />
                ) : (
                  <div className="product-placeholder" />
                )}
                <div className="product-name">{meal.name}</div>
                {meal.price != null ? <div className="product-price">{meal.price}€</div> : null}
              </div>
            ))}
          </div>
          {normalizedMealSearch && uncategorizedMenuItems.length === 0 ? (
            <p className="muted" style={{ marginTop: 12 }}>Haulla ei löytynyt annoksia.</p>
          ) : null}
        </div>
      )}
    </>
  );

  const renderEditingMealPicker = (orderId, editState) => {
    const { normalizedSearch, filtered, groups } = getEditingMenuData(editState);

    return (
      <>
        <div className="field-group" style={{ marginBottom: 16 }}>
          <label>Hae annosta tai kategoriaa</label>
          <input
            className="input"
            type="text"
            placeholder="Kirjoita annoksen tai kategorian nimi..."
            value={editState.mealSearch}
            onChange={(event) =>
              updateEditingOrderState(orderId, {
                ...editState,
                mealSearch: event.target.value,
              })
            }
          />
        </div>
        <div className="controls-row" style={{ marginBottom: 16 }}>
          <button className="btn btn-secondary btn-small" onClick={() => toggleEditingShowCategories(orderId)}>
            {editState.showCategories ? "Piilota kategoriat" : "Näytä kategoriat"}
          </button>
        </div>

        {editState.showCategories ? (
          <DragDropContext onDragEnd={(result) => onEditingMenuCategoryDragEnd(orderId, result)}>
            <Droppable droppableId={`cashier-menu-categories-${orderId}`} direction="vertical" type="MENU_CATEGORY">
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="content-stack">
                  {groups.map((category, index) => (
                    <Draggable key={category.id} draggableId={`${orderId}-${category.id}`} index={index}>
                      {(draggableProvided) => (
                        <div
                          ref={draggableProvided.innerRef}
                          {...draggableProvided.draggableProps}
                          className="panel menu-category-panel"
                          style={draggableProvided.draggableProps.style}
                        >
                          <div className="menu-category-header menu-category-drag-handle" {...draggableProvided.dragHandleProps}>
                            <h3 className="panel-title">{category.name}</h3>
                            <div className="controls-row">
                              <span className="menu-category-hint">{CATEGORY_DRAG_HINT}</span>
                              <button
                                className="btn btn-secondary btn-small"
                                onClick={() => toggleEditingCategoryCollapsed(orderId, category.id)}
                              >
                                {editState.collapsedCategoryIds?.[category.id] ? "Näytä kategoria" : "Piilota kategoria"}
                              </button>
                            </div>
                          </div>
                          {!editState.collapsedCategoryIds?.[category.id] ? (
                            <div className="product-grid">
                              {category.items.map((meal) => (
                                <div
                                  key={meal.id}
                                  className="product-card clickable"
                                  onClick={() => addToEditingOrderFromMenu(orderId, meal.id)}
                                >
                                  {meal.image ? (
                                    <img className="product-image" src={meal.image} alt={meal.name} />
                                  ) : (
                                    <div className="product-placeholder" />
                                  )}
                                  <div className="product-name">{meal.name}</div>
                                  {meal.price != null ? <div className="product-price">{meal.price}€</div> : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {normalizedSearch && groups.length === 0 ? <p className="muted">Haulla ei löytynyt annoksia.</p> : null}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        ) : (
          <div className="panel menu-category-panel">
            <div className="product-grid">
              {filtered.map((meal) => (
                <div key={meal.id} className="product-card clickable" onClick={() => addToEditingOrderFromMenu(orderId, meal.id)}>
                  {meal.image ? <img className="product-image" src={meal.image} alt={meal.name} /> : <div className="product-placeholder" />}
                  <div className="product-name">{meal.name}</div>
                  {meal.price != null ? <div className="product-price">{meal.price}€</div> : null}
                </div>
              ))}
            </div>
            {normalizedSearch && filtered.length === 0 ? <p className="muted" style={{ marginTop: 12 }}>Haulla ei löytynyt annoksia.</p> : null}
          </div>
        )}
      </>
    );
  };

  const renderCashierOrderEditor = (isInline = false) => (
    <div ref={isInline ? editRef : undefined}>
      {!isInline ? (
        <h2 className="panel-title row">
          <span className="panel-title-accent">Uusi tilaus</span>
          <span className="panel-title-muted">Pöytä {table}</span>
        </h2>
      ) : null}

      {renderCashierMealPicker()}

      <div className="panel" style={{ marginTop: 18, padding: 16 }}>
        <h3 className="panel-title">Tilauksen annokset</h3>
        <div className="order-item-list">
          {currentOrder.map((item, index) => (
            <div key={index} className="order-item-row">
              <div className="order-item-main">
                <span>{item.meal} x</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={item.qty}
                  onChange={(event) => {
                    const qty = parseInt(event.target.value, 10) || 1;
                    setCurrentOrder((previous) => {
                      setOrderChanged(true);
                      return previous.map((existing, itemIndex) =>
                        itemIndex === index ? { ...existing, qty } : existing
                      );
                    });
                  }}
                />
              </div>
              <input
                className="input order-item-notes"
                type="text"
                placeholder="Lisätietoa..."
                value={item.notes}
                onChange={(event) => {
                  const notes = event.target.value;
                  setCurrentOrder((previous) => {
                    setOrderChanged(true);
                    return previous.map((existing, itemIndex) =>
                      itemIndex === index ? { ...existing, notes } : existing
                    );
                  });
                }}
              />
              <button
                className="btn btn-danger btn-small"
                onClick={() =>
                  setCurrentOrder((previous) => {
                    setOrderChanged(true);
                    return previous.filter((_, itemIndex) => itemIndex !== index);
                  })
                }
              >
                Poista
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="controls-row" style={{ marginTop: 18 }}>
        <button className="btn btn-primary" onClick={saveOrder} disabled={!orderChanged}>
          Tallenna tilaus
        </button>
        <button className="btn btn-secondary" onClick={cancelEdit}>
          Peruuta
        </button>
      </div>
    </div>
  );

  const renderEditingOrderEditor = (orderId, editState) => (
    <div ref={editRef}>
      {renderEditingMealPicker(orderId, editState)}

      <div className="panel" style={{ marginTop: 18, padding: 16 }}>
        <h3 className="panel-title">Tilauksen annokset</h3>
        <div className="order-item-list">
          {editState.currentOrder.map((item, index) => (
            <div key={index} className="order-item-row">
              <div className="order-item-main">
                <span>{item.meal} x</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  value={item.qty}
                  onChange={(event) => {
                    const qty = parseInt(event.target.value, 10) || 1;
                    updateEditingOrderState(orderId, (existing) => ({
                      ...existing,
                      orderChanged: true,
                      currentOrder: existing.currentOrder.map((existingItem, itemIndex) =>
                        itemIndex === index ? { ...existingItem, qty } : existingItem
                      ),
                    }));
                  }}
                />
              </div>
              <input
                className="input order-item-notes"
                type="text"
                placeholder="Lisätietoa..."
                value={item.notes}
                onChange={(event) => {
                  const notes = event.target.value;
                  updateEditingOrderState(orderId, (existing) => ({
                    ...existing,
                    orderChanged: true,
                    currentOrder: existing.currentOrder.map((existingItem, itemIndex) =>
                      itemIndex === index ? { ...existingItem, notes } : existingItem
                    ),
                  }));
                }}
              />
              <button
                className="btn btn-danger btn-small"
                onClick={() =>
                  updateEditingOrderState(orderId, (existing) => ({
                    ...existing,
                    orderChanged: true,
                    currentOrder: existing.currentOrder.filter((_, itemIndex) => itemIndex !== index),
                  }))
                }
              >
                Poista
              </button>
            </div>
          ))}
          {editState.currentOrder.length > 0 ? (
            <div className="order-item-row" style={{ marginTop: 8 }}>
              <div className="order-item-main" />
              <div className="order-item-notes" />
              <button className="btn btn-danger btn-small" onClick={() => deleteEditingOrder(orderId)}>
                Poista koko tilaus
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="controls-row" style={{ marginTop: 18 }}>
        <button className="btn btn-primary" onClick={() => saveEditingOrder(orderId)} disabled={!editState.orderChanged}>
          Tallenna tilaus
        </button>
        <button className="btn btn-secondary" onClick={() => cancelEditingOrder(orderId)}>
          Peruuta
        </button>
      </div>
    </div>
  );

  return (
    <div className="screen">
      <ScreenHeader
        title="Kassa"
        subtitle="Luo, muokkaa ja seuraa pöytätilauksia samalla visuaalisella rytmillä kuin keittiössä."
      />

      <div className="content-stack">
        {!newOrderMode && !hasOpenEdits ? (
          <div className="panel">
            <div className="controls-row">
              <div className="field-group">
                <label>Pöytä</label>
                <select className="select" value={table} onChange={(event) => setTable(event.target.value)}>
                  {availableTables.map((candidate) => (
                    <option key={candidate} value={candidate}>
                      {candidate}
                    </option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" onClick={startNewOrder}>
                Uusi tilaus
              </button>
            </div>
          </div>
        ) : null}

        {newOrderMode ? (
          <div ref={editRef} className="panel">
            {renderCashierOrderEditor(false)}
          </div>
        ) : null}

        <DragDropContext onDragEnd={onCategoryDragEnd}>
          <Droppable droppableId="categories" direction="vertical" type="CATEGORY">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps}>
                {categoryOrder.map((status, index) => {
                  const visibleOrders = groupedOrders[status];
                  if (!visibleOrders || visibleOrders.length === 0) {
                    return null;
                  }

                  return (
                    <Draggable draggableId={status} index={index} key={status}>
                      {(draggableProvided) => (
                        <div
                          ref={draggableProvided.innerRef}
                          {...draggableProvided.draggableProps}
                          style={{ marginBottom: 16, ...draggableProvided.draggableProps.style }}
                        >
                          <div className="panel">
                            <div className="cashier-section-head" {...draggableProvided.dragHandleProps}>
                              <h2 className="panel-title">{statusTitles[status]}</h2>
                              <span className="cashier-section-count">{visibleOrders.length} tilausta</span>
                            </div>
                            <div className="order-list">
                              {visibleOrders.map((order) => {
                                const groupedItems = groupOrderItems(order.items);
                                const editState = editingOrders[order.id];

                                return (
                                  <div
                                    key={order.id}
                                    className={`order-card cashier-order-card ${status}`}
                                    style={{ background: statusColors[status] || "#fff" }}
                                  >
                                    {!editState ? (
                                      <>
                                        <div className="order-card-head">
                                          <div className="cashier-order-main">
                                            <span className="order-table">Pöytä {order.table}</span>
                                            <span className="cashier-order-badge">{groupedItems.length} riviä</span>
                                          </div>
                                          <span className="order-time cashier-order-time">
                                            {new Date(order.createdAt).toLocaleTimeString([], {
                                              hour: "2-digit",
                                              minute: "2-digit",
                                              hour12: false,
                                            })}
                                          </span>
                                        </div>

                                        <div className="cashier-items">
                                          {groupedItems.map((item, itemIndex) => (
                                            <div key={itemIndex} className="cashier-item-row">
                                              <span className="cashier-item-qty">{item.qty}x</span>
                                              <span className="cashier-item-name">{item.meal}</span>
                                              {item.notes ? <span className="cashier-item-notes">{item.notes}</span> : null}
                                            </div>
                                          ))}
                                        </div>
                                        <div className="cashier-order-actions">
                                          {["waiting", "cooking", "ready"].includes(status) ? (
                                            <button
                                              className="btn btn-primary btn-small"
                                              onClick={() => startEditOrder(order)}
                                            >
                                              Muokkaa
                                            </button>
                                          ) : null}
                                          {status === "ready" ? (
                                            <button
                                              className="btn btn-success btn-small"
                                              onClick={() => {
                                                if (window.confirm("Haluatko merkitä tilauksen viety pöytään?")) {
                                                  update(ref(db, `orders/${order.id}`), { status: "poydassa" });
                                                }
                                              }}
                                            >
                                              Viety pöytään
                                            </button>
                                          ) : null}
                                          {status === "poydassa" ? (
                                            <button
                                              className="btn btn-danger btn-small"
                                              onClick={() => closeTable(order)}
                                            >
                                              Sulje pöytä
                                            </button>
                                          ) : null}
                                        </div>
                                      </>
                                    ) : null}
                                    {editState ? (
                                      <div className="cashier-inline-editor">
                                        <div className="panel cashier-inline-editor-panel">
                                          <h3 className="panel-title row">
                                            <span className="panel-title-accent">Muokkaa tilausta</span>
                                            <span className="panel-title-muted">Pöytä {editState.table}</span>
                                          </h3>
                                          {renderEditingOrderEditor(order.id, editState)}
                                        </div>
                                      </div>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </div>
                      )}
                    </Draggable>
                  );
                })}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      </div>
    </div>
  );
}

function KitchenApp() {
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    onValue(ref(db, "orders"), (snapshot) => {
      const data = snapshot.val() || {};
      setOrders(Object.entries(data).map(([id, value]) => ({ id, ...value })));
    });
  }, []);

  const updateStatus = (id, status, orderIndex = null) =>
    update(ref(db, `orders/${id}`), { status, orderIndex: orderIndex ?? Date.now() });

  const onDragEnd = (result) => {
    if (!result.destination) {
      return;
    }

    const { source, destination, draggableId } = result;
    const sourceStatus = source.droppableId;
    const destinationStatus = destination.droppableId;
    const filtered = orders
      .filter((order) => order.status === destinationStatus)
      .sort((left, right) => (left.orderIndex || 0) - (right.orderIndex || 0));
    const moved = orders.find((order) => order.id === draggableId);
    const newIndex = destination.index;

    if (destinationStatus === sourceStatus) {
      filtered.splice(source.index, 1);
    }

    filtered.splice(newIndex, 0, moved);
    filtered.forEach((order, index) => updateStatus(order.id, destinationStatus, index));

    if (destinationStatus !== sourceStatus) {
      updateStatus(moved.id, destinationStatus, newIndex);
    }
  };

  const categories = ["waiting", "cooking", "ready"];
  const grouped = { waiting: [], cooking: [], ready: [] };
  orders.forEach((order) => {
    if (grouped[order.status]) {
      grouped[order.status].push(order);
    }
  });

  return (
    <div className="screen">
      <ScreenHeader
        title="Keittiö"
        subtitle="Vedä tilaukset vaiheesta toiseen ja kuittaa muutokset heti valmistuksen aikana."
      />

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="board-columns">
          {categories.map((status) => (
            <Droppable droppableId={status} key={status}>
              {(provided) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`status-column ${status}`}
                >
                  <div className="kitchen-column-head">
                    <h2 className="panel-title">{statusTitles[status]}</h2>
                    <span className="kitchen-column-count">{grouped[status].length} tilausta</span>
                  </div>
                  <div className="order-list">
                    {grouped[status]
                      .sort((left, right) => (left.orderIndex || 0) - (right.orderIndex || 0))
                      .map((order, index) => {
                        const groupedItems = groupOrderItems(order.items);

                        return (
                        <Draggable draggableId={order.id} index={index} key={order.id}>
                          {(draggableProvided) => (
                            <div
                              ref={draggableProvided.innerRef}
                              {...draggableProvided.draggableProps}
                              {...draggableProvided.dragHandleProps}
                              className={`order-card kitchen-order-card ${status}${order.updated ? " is-updated" : ""}`}
                              style={draggableProvided.draggableProps.style}
                            >
                              <div className="order-card-head">
                                <div className="kitchen-order-main">
                                  <span className="order-table">Pöytä {order.table}</span>
                                  <span className="kitchen-order-badge">{groupedItems.length} riviä</span>
                                </div>
                                  <span className="order-time kitchen-order-time">
                                    {new Date(order.createdAt).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      hour12: false,
                                    })}
                                  </span>
                              </div>

                              {order.updated ? (
                                <div className="warning">
                                  Huom! Tilausta muokattu
                                  <button
                                    className="btn btn-secondary btn-small btn-inline"
                                    onClick={() =>
                                      update(ref(db, `orders/${order.id}`), {
                                        updated: false,
                                        editSummary: null,
                                        editBaseItems: null,
                                      })
                                    }
                                  >
                                    Kuittaa
                                  </button>
                                </div>
                              ) : null}

                              {order.updated && order.editSummary ? (
                                <div className="change-summary">
                                  {order.editSummary.added?.length > 0 ? (
                                    <div className="change-group added">
                                      <div className="change-group-title">Lisätty</div>
                                      {order.editSummary.added.map((item, itemIndex) => (
                                        <div key={`added-${itemIndex}`} className="change-row">
                                          + {item.meal} x{item.qty} {item.notes ? <em>({item.notes})</em> : null}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                  {order.editSummary.removed?.length > 0 ? (
                                    <div className="change-group removed">
                                      <div className="change-group-title">Poistettu</div>
                                      {order.editSummary.removed.map((item, itemIndex) => (
                                        <div key={`removed-${itemIndex}`} className="change-row">
                                          - {item.meal} x{item.qty} {item.notes ? <em>({item.notes})</em> : null}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                  {order.editSummary.changed?.length > 0 ? (
                                    <div className="change-group changed">
                                      <div className="change-group-title">Määrä muuttui</div>
                                      {order.editSummary.changed.map((item, itemIndex) => (
                                        <div key={`changed-${itemIndex}`} className="change-row">
                                          {item.meal} {item.notes ? <em>({item.notes})</em> : null} {item.fromQty} {"->"} {item.toQty}
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ) : null}

                              <div className="kitchen-items">
                                {groupedItems.map((item, itemIndex) => (
                                  <div
                                    key={itemIndex}
                                    className={`kitchen-item-row${order.updated ? " updated-item-row" : ""}`}
                                  >
                                    <span className="kitchen-item-qty">{item.qty}x</span>
                                    <span className="kitchen-item-name">{item.meal}</span>
                                    {item.notes ? <span className="kitchen-item-notes">{item.notes}</span> : null}
                                  </div>
                                ))}
                              </div>
                              </div>
                            )}
                          </Draggable>
                        );
                      })}
                  </div>
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>
    </div>
  );
}

function AdminApp({ menu, categories }) {
  const [orders, setOrders] = useState([]);
  const [pastOrders, setPastOrders] = useState([]);
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [imageFile, setImageFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [editingCategory, setEditingCategory] = useState(null);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [adminToolOrder, setAdminToolOrder] = useState(ADMIN_TOOL_PANELS);
  const [menuCategoryOrder, setMenuCategoryOrder] = useState([]);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [showMealForm, setShowMealForm] = useState(false);
  const [collapsedPanels, setCollapsedPanels] = useState({});
  const [mealSearch, setMealSearch] = useState("");
  const [showCategories, setShowCategories] = useState(true);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState({});
  const [inlineEditingCategoryId, setInlineEditingCategoryId] = useState(null);
  const [inlineCategoryName, setInlineCategoryName] = useState("");
  const [inlineEditingMealId, setInlineEditingMealId] = useState(null);
  const [inlineMealName, setInlineMealName] = useState("");
  const [inlineMealPrice, setInlineMealPrice] = useState("");
  const [inlineMealCategoryId, setInlineMealCategoryId] = useState("");

  useEffect(() => {
    onValue(ref(db, "orders"), (snapshot) => {
      const data = snapshot.val() || {};
      setOrders(Object.entries(data).map(([id, value]) => ({ id, ...value })));
    });
  }, []);

  useEffect(() => {
    onValue(ref(db, "pastOrders"), (snapshot) => {
      const data = snapshot.val() || {};
      setPastOrders(Object.entries(data).map(([id, value]) => ({ id, ...value })));
    });
  }, []);

  const resetForm = () => {
    setEditing(null);
    setName("");
    setPrice("");
    setSelectedCategoryId("");
    setImageFile(null);
    setShowMealForm(false);
  };

  const saveMeal = async () => {
    if (!name || !price) {
      alert("Täytä nimi ja hinta");
      return;
    }

    setLoading(true);
    let imageUrl = editing ? editing.image : null;

    if (imageFile) {
      const imageRef = sRef(storage, `menu/${Date.now()}_${imageFile.name}`);
      await uploadBytes(imageRef, imageFile);
      imageUrl = await getDownloadURL(imageRef);
    }

    const mealData = {
      name,
      price: Number(price),
      image: imageUrl || "",
      categoryId: selectedCategoryId || "",
      order: editing?.order ?? menu.length,
    };
    if (editing) {
      update(ref(db, `menu/${editing.id}`), mealData);
    } else {
      push(ref(db, "menu"), mealData);
    }

    resetForm();
    setLoading(false);
  };

  const startInlineEdit = (meal) => {
    setInlineEditingMealId(meal.id);
    setInlineMealName(meal.name);
    setInlineMealPrice(String(meal.price ?? ""));
    setInlineMealCategoryId(meal.categoryId || "");
  };

  const cancelInlineEdit = () => {
    setInlineEditingMealId(null);
    setInlineMealName("");
    setInlineMealPrice("");
    setInlineMealCategoryId("");
  };

  const saveInlineMeal = async (meal) => {
    if (!inlineMealName.trim() || inlineMealPrice === "") {
      alert("Täytä nimi ja hinta");
      return;
    }

    await update(ref(db, `menu/${meal.id}`), {
      name: inlineMealName.trim(),
      price: Number(inlineMealPrice),
      categoryId: inlineMealCategoryId || "",
    });
    cancelInlineEdit();
  };

  const deleteMeal = (meal) => {
    if (window.confirm("Poista annos?")) {
      remove(ref(db, `menu/${meal.id}`));
    }
  };

  const resetCategoryForm = () => {
    setEditingCategory(null);
    setCategoryName("");
    setShowCategoryForm(false);
  };

  const saveCategory = async () => {
    if (!categoryName.trim()) {
      alert("Täytä kategorian nimi");
      return;
    }

    setCategoryLoading(true);
    const categoryData = {
      name: categoryName.trim(),
      order: editingCategory?.order ?? categories.length,
    };

    if (editingCategory) {
      await update(ref(db, `categories/${editingCategory.id}`), categoryData);
    } else {
      await push(ref(db, "categories"), categoryData);
    }

    resetCategoryForm();
    setCategoryLoading(false);
  };

  const startEditCategory = (category) => {
    setInlineEditingCategoryId(category.id);
    setInlineCategoryName(category.name);
  };

  const cancelInlineCategoryEdit = () => {
    setInlineEditingCategoryId(null);
    setInlineCategoryName("");
  };

  const saveInlineCategory = async (category) => {
    if (!inlineCategoryName.trim()) {
      alert("Täytä kategorian nimi");
      return;
    }

    await update(ref(db, `categories/${category.id}`), {
      name: inlineCategoryName.trim(),
      order: category.order ?? categories.length,
    });
    cancelInlineCategoryEdit();
  };

  const deleteCategory = async (category) => {
    if (!window.confirm("Poista kategoria? Annokset siirtyvät tyhjään kategoriaan.")) {
      return;
    }

    const affectedMeals = menu.filter((meal) => meal.categoryId === category.id);
    if (affectedMeals.length > 0) {
      const updates = {};
      affectedMeals.forEach((meal) => {
        updates[`menu/${meal.id}/categoryId`] = "";
      });
      await update(ref(db), updates);
    }

    await remove(ref(db, `categories/${category.id}`));
    if (editingCategory?.id === category.id) resetCategoryForm();
    if (inlineEditingCategoryId === category.id) cancelInlineCategoryEdit();
  };

  const reorderAdminTools = (result) => {
    const nextOrder = Array.from(adminToolOrder);
    const [removed] = nextOrder.splice(result.source.index, 1);
    nextOrder.splice(result.destination.index, 0, removed);
    setAdminToolOrder(nextOrder);
  };

  const moveMealBetweenCategories = async (result) => {
    const sourceCategoryId = result.source.droppableId.replace("admin-category-", "");
    const destinationCategoryId = result.destination.droppableId.replace("admin-category-", "");
    const grouped = buildCategoryGroups(
      menu,
      categories,
      categories.map((category) => category.id),
      true
    );
    const sourceCategory = grouped.find((category) => category.id === sourceCategoryId);
    const destinationCategory = grouped.find((category) => category.id === destinationCategoryId);
    const movingMeal = sourceCategory?.items[result.source.index];

    if (!sourceCategory || !destinationCategory || !movingMeal) {
      return;
    }

    const nextSourceItems = Array.from(sourceCategory.items);
    nextSourceItems.splice(result.source.index, 1);

    const movedMeal = {
      ...movingMeal,
      categoryId: destinationCategoryId === UNCATEGORIZED_ID ? "" : destinationCategoryId,
    };

    const nextDestinationItems =
      sourceCategoryId === destinationCategoryId ? nextSourceItems : Array.from(destinationCategory.items);
    nextDestinationItems.splice(result.destination.index, 0, movedMeal);

    const updates = {};
    const nextCategoryId = destinationCategoryId === UNCATEGORIZED_ID ? "" : destinationCategoryId;
    nextSourceItems.forEach((meal, index) => {
      updates[`menu/${meal.id}/order`] = index;
      if (sourceCategoryId !== destinationCategoryId && meal.categoryId !== movingMeal.categoryId) {
        updates[`menu/${meal.id}/categoryId`] = meal.categoryId || "";
      }
    });

    nextDestinationItems.forEach((meal, index) => {
      updates[`menu/${meal.id}/order`] = index;
      if ((meal.categoryId || "") !== nextCategoryId) {
        updates[`menu/${meal.id}/categoryId`] = nextCategoryId;
      }
    });

    updates[`menu/${movingMeal.id}/categoryId`] = nextCategoryId;

    await update(ref(db), updates);
  };

  const onAdminDragEnd = async (result) => {
    if (!result.destination) {
      return;
    }

    if (result.type === "ADMIN_TOOL") {
      reorderAdminTools(result);
      return;
    }

    if (result.type === "ADMIN_CATEGORY") {
      const nextOrder = Array.from(effectiveMenuCategoryOrder);
      const [removed] = nextOrder.splice(result.source.index, 1);
      nextOrder.splice(result.destination.index, 0, removed);
      setMenuCategoryOrder(nextOrder);
      return;
    }

    if (result.type === "ADMIN_MEAL") {
      await moveMealBetweenCategories(result);
    }
  };

  const toggleCategoryCollapsed = (categoryId) => {
    setCollapsedCategoryIds((previous) => ({
      ...previous,
      [categoryId]: !previous[categoryId],
    }));
  };

  const endDay = async () => {
    if (
      !window.confirm(
        "Haluatko varmasti lopettaa päivän? Tämä tyhjentää kaikki tilaukset, vapauttaa pöydät ja nollaa päivän myynnin."
      )
    ) {
      return;
    }

    await Promise.all([remove(ref(db, "orders")), remove(ref(db, "pastOrders"))]);
  };

  const todaysClosedOrders = [...pastOrders, ...orders.filter((order) => order.status === "menneet")]
    .filter((order) => order.status === "menneet" && isSameLocalDay(order.closedAt || order.createdAt))
    .sort((left, right) => (right.closedAt || right.createdAt || 0) - (left.closedAt || left.createdAt || 0));

  const menuPriceMap = new Map(menu.map((meal) => [meal.id, Number(meal.price) || 0]));
  const salesSummaryMap = {};
  let todaysRevenue = 0;

  todaysClosedOrders.forEach((order) => {
    (order.items || []).forEach((item) => {
      const quantity = Number(item.qty) || 0;
      const unitPrice =
        item.price != null && item.price !== ""
          ? Number(item.price) || 0
          : menuPriceMap.get(item.mealId) || 0;
      const lineTotal = unitPrice * quantity;
      const key = `${item.mealId || item.meal}___${item.meal}___${item.notes || ""}`;

      todaysRevenue += lineTotal;
      if (!salesSummaryMap[key]) {
        salesSummaryMap[key] = {
          meal: item.meal,
          notes: item.notes || "",
          qty: 0,
          revenue: 0,
        };
      }

      salesSummaryMap[key].qty += quantity;
      salesSummaryMap[key].revenue += lineTotal;
    });
  });

  const salesSummary = Object.values(salesSummaryMap).sort((left, right) => right.qty - left.qty);
  const effectiveMenuCategoryOrder = (() => {
    const availableCategoryIds = [...categories.map((category) => category.id), UNCATEGORIZED_ID];
    const filtered = menuCategoryOrder.filter((id) => availableCategoryIds.includes(id));
    const missing = availableCategoryIds.filter((id) => !filtered.includes(id));
    return [...filtered, ...missing];
  })();
  const normalizedMealSearch = mealSearch.trim().toLowerCase();
  const categoryNameMap = new Map(
    categories.map((category) => [category.id, category.name.toLowerCase()])
  );
  const filteredMenu = normalizedMealSearch
    ? menu.filter((meal) => {
        const mealNameMatch = meal.name.toLowerCase().includes(normalizedMealSearch);
        const mealCategoryName =
          categoryNameMap.get(meal.categoryId || "") ||
          (normalizeCategoryId(meal.categoryId) === UNCATEGORIZED_ID ? UNCATEGORIZED_LABEL.toLowerCase() : "");
        const categoryMatch = mealCategoryName.includes(normalizedMealSearch);
        return mealNameMatch || categoryMatch;
      })
    : menu;

  const togglePanelCollapsed = (panelId) => {
    setCollapsedPanels((previous) => ({
      ...previous,
      [panelId]: !previous[panelId],
    }));
  };

  const adminPanels = {
    "menu-list": (
      <div className="panel admin-menu-panel">
        <div className="menu-category-header">
          <div>
            <h2 className="panel-title">Ruokalista</h2>
            <p className="muted" style={{ marginTop: -4, marginBottom: 0 }}>
              Vedä annoksia kategorioiden välillä tai järjestele niitä kategorian sisällä.
            </p>
          </div>
          <button
            className="btn btn-primary btn-small"
            onClick={() => {
              setEditingCategory(null);
              setCategoryName("");
              setShowCategoryForm((current) => !current);
            }}
          >
            Uusi kategoria
          </button>
          <button
            className="btn btn-secondary btn-small"
            onClick={() => {
              setEditing(null);
              setName("");
              setPrice("");
              setSelectedCategoryId("");
              setImageFile(null);
              setInlineEditingMealId(null);
              setShowMealForm(true);
            }}
          >
            Lisää uusi annos
          </button>
        </div>
        {showMealForm ? (
          <div className="panel admin-inline-form">
            <h3 className="panel-title">{editing ? "Muokkaa annosta" : "Lisää uusi annos"}</h3>
            <div className="content-stack">
              <div className="field-group">
                <label>Nimi</label>
                <input
                  className="input"
                  type="text"
                  placeholder="Esim. Tuplajuustoburger"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Hinta</label>
                <input
                  className="input"
                  type="number"
                  placeholder="0"
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                />
              </div>
              <div className="field-group">
                <label>Kategoria</label>
                <select
                  className="select"
                  value={selectedCategoryId}
                  onChange={(event) => setSelectedCategoryId(event.target.value)}
                >
                  <option value="">Tyhjä kategoria</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label>Kuva</label>
                <input
                  className="file-input"
                  type="file"
                  onChange={(event) => setImageFile(event.target.files[0])}
                />
              </div>
              <div className="controls-row">
                <button className="btn btn-primary" onClick={saveMeal} disabled={loading}>
                  {editing ? "Tallenna muutokset" : "Lisää annos"}
                </button>
                <button className="btn btn-secondary" onClick={resetForm}>
                  Peruuta
                </button>
              </div>
            </div>
          </div>
        ) : null}
        {showCategoryForm ? (
          <div className="panel admin-inline-form">
            <div className="field-group">
              <label>Kategorian nimi</label>
              <input
                className="input"
                type="text"
                placeholder="Esim. Burgerit"
                value={categoryName}
                onChange={(event) => setCategoryName(event.target.value)}
              />
            </div>
            <div className="controls-row" style={{ marginTop: 12 }}>
              <button className="btn btn-primary" onClick={saveCategory} disabled={categoryLoading}>
                {editingCategory ? "Tallenna kategoria" : "Lisää kategoria"}
              </button>
              <button className="btn btn-secondary" onClick={resetCategoryForm}>
                Peruuta
              </button>
            </div>
          </div>
        ) : null}
        <div className="field-group" style={{ marginBottom: 16 }}>
          <label>Hae annosta tai kategoriaa</label>
          <input
            className="input"
            type="text"
            placeholder="Kirjoita annoksen tai kategorian nimi..."
            value={mealSearch}
            onChange={(event) => setMealSearch(event.target.value)}
          />
        </div>
        <div className="controls-row" style={{ marginBottom: 16 }}>
          <button className="btn btn-secondary btn-small" onClick={() => setShowCategories((current) => !current)}>
            {showCategories ? "Piilota kategoriat" : "Näytä kategoriat"}
          </button>
        </div>
        <div className="content-stack">
          {showCategories ? (
            <Droppable droppableId="admin-menu-categories" direction="vertical" type="ADMIN_CATEGORY">
              {(categoryProvided) => (
                <div ref={categoryProvided.innerRef} {...categoryProvided.droppableProps} className="content-stack">
                  {buildCategoryGroups(filteredMenu, categories, effectiveMenuCategoryOrder, true)
                    .filter((category) => category.items.length > 0 || !normalizedMealSearch)
                    .map((category, categoryIndex) => (
                      <Draggable key={category.id} draggableId={`admin-category-order-${category.id}`} index={categoryIndex}>
                        {(categoryDraggableProvided) => (
                          <div
                            ref={categoryDraggableProvided.innerRef}
                            {...categoryDraggableProvided.draggableProps}
                            className="admin-category-block"
                            style={categoryDraggableProvided.draggableProps.style}
                          >
                            <div className="menu-category-header">
                              <div className="admin-category-title-wrap" {...categoryDraggableProvided.dragHandleProps}>
                                {inlineEditingCategoryId === category.id ? (
                                  <div className="content-stack" style={{ gap: 8, flex: 1 }}>
                                    <input
                                      className="input"
                                      type="text"
                                      value={inlineCategoryName}
                                      onChange={(event) => setInlineCategoryName(event.target.value)}
                                      placeholder="Kategorian nimi"
                                    />
                                    <div className="controls-row admin-inline-actions">
                                      <button className="btn btn-primary btn-small" onClick={() => saveInlineCategory(category)}>
                                        Tallenna
                                      </button>
                                      <button className="btn btn-secondary btn-small" onClick={cancelInlineCategoryEdit}>
                                        Peruuta
                                      </button>
                                      <button
                                        className="btn btn-danger btn-small admin-inline-danger"
                                        onClick={() => deleteCategory(category)}
                                      >
                                        Poista kategoria
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <h3 className="panel-title">{category.name}</h3>
                                    <span className="menu-category-hint">{CATEGORY_DRAG_HINT}</span>
                                  </>
                                )}
                              </div>
                              <div className="controls-row">
                                {inlineEditingCategoryId !== category.id ? (
                                  <button
                                    className="btn btn-secondary btn-small"
                                    onClick={() => toggleCategoryCollapsed(category.id)}
                                  >
                                    {collapsedCategoryIds[category.id] ? "Näytä" : "Piilota"}
                                  </button>
                                ) : null}
                                {category.id !== UNCATEGORIZED_ID && inlineEditingCategoryId !== category.id ? (
                                  <button className="btn btn-primary btn-small" onClick={() => startEditCategory(category)}>
                                    Muokkaa
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            {!collapsedCategoryIds[category.id] ? (
                              <Droppable droppableId={`admin-category-${category.id}`} type="ADMIN_MEAL">
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.droppableProps}
                                    className={`product-grid admin-dropzone${snapshot.isDraggingOver ? " is-over" : ""}`}
                                  >
                                    {category.items.map((meal, index) => (
                                      <Draggable key={meal.id} draggableId={meal.id} index={index}>
                                        {(draggableProvided) => (
                                          <div
                                            ref={draggableProvided.innerRef}
                                            {...draggableProvided.draggableProps}
                                            {...draggableProvided.dragHandleProps}
                                            className="product-card admin-draggable-card"
                                            style={draggableProvided.draggableProps.style}
                                          >
                                            {meal.image ? (
                                              <img className="product-image" src={meal.image} alt={meal.name} />
                                            ) : (
                                              <div className="product-placeholder" />
                                            )}
                                            {inlineEditingMealId === meal.id ? (
                                              <div className="content-stack" style={{ gap: 8, marginTop: 10 }}>
                                                <input
                                                  className="input"
                                                  type="text"
                                                  value={inlineMealName}
                                                  onChange={(event) => setInlineMealName(event.target.value)}
                                                  placeholder="Nimi"
                                                />
                                                <input
                                                  className="input"
                                                  type="number"
                                                  value={inlineMealPrice}
                                                  onChange={(event) => setInlineMealPrice(event.target.value)}
                                                  placeholder="Hinta"
                                                />
                                                <select
                                                  className="select"
                                                  value={inlineMealCategoryId}
                                                  onChange={(event) => setInlineMealCategoryId(event.target.value)}
                                                >
                                                  <option value="">Tyhjä kategoria</option>
                                                  {categories.map((categoryOption) => (
                                                    <option key={categoryOption.id} value={categoryOption.id}>
                                                      {categoryOption.name}
                                                    </option>
                                                  ))}
                                                </select>
                                                <div className="content-stack" style={{ gap: 8 }}>
                                                  <button className="btn btn-primary btn-small" onClick={() => saveInlineMeal(meal)}>
                                                    Tallenna
                                                  </button>
                                                  <button className="btn btn-secondary btn-small" onClick={cancelInlineEdit}>
                                                    Peruuta
                                                  </button>
                                                </div>
                                              </div>
                                            ) : (
                                              <>
                                                <div className="product-name">{meal.name}</div>
                                                <div className="product-price">{meal.price}€</div>
                                                <div className="content-stack" style={{ gap: 8, marginTop: 12 }}>
                                                  <button className="btn btn-primary btn-small" onClick={() => startInlineEdit(meal)}>
                                                    Muokkaa
                                                  </button>
                                                  <button className="btn btn-danger btn-small" onClick={() => deleteMeal(meal)}>
                                                    Poista
                                                  </button>
                                                </div>
                                              </>
                                            )}
                                          </div>
                                        )}
                                      </Draggable>
                                    ))}
                                    {provided.placeholder}
                                  </div>
                                )}
                              </Droppable>
                            ) : null}
                          </div>
                        )}
                      </Draggable>
                    ))}
                  {categoryProvided.placeholder}
                </div>
              )}
            </Droppable>
          ) : (
            <div className="panel menu-category-panel">
              <div className="product-grid">
                {filteredMenu.map((meal) => (
                  <div key={meal.id} className="product-card">
                    {meal.image ? (
                      <img className="product-image" src={meal.image} alt={meal.name} />
                    ) : (
                      <div className="product-placeholder" />
                    )}
                    {inlineEditingMealId === meal.id ? (
                      <div className="content-stack" style={{ gap: 8, marginTop: 10 }}>
                        <input
                          className="input"
                          type="text"
                          value={inlineMealName}
                          onChange={(event) => setInlineMealName(event.target.value)}
                          placeholder="Nimi"
                        />
                        <input
                          className="input"
                          type="number"
                          value={inlineMealPrice}
                          onChange={(event) => setInlineMealPrice(event.target.value)}
                          placeholder="Hinta"
                        />
                        <select
                          className="select"
                          value={inlineMealCategoryId}
                          onChange={(event) => setInlineMealCategoryId(event.target.value)}
                        >
                          <option value="">Tyhjä kategoria</option>
                          {categories.map((categoryOption) => (
                            <option key={categoryOption.id} value={categoryOption.id}>
                              {categoryOption.name}
                            </option>
                          ))}
                        </select>
                        <div className="content-stack" style={{ gap: 8 }}>
                          <button className="btn btn-primary btn-small" onClick={() => saveInlineMeal(meal)}>
                            Tallenna
                          </button>
                          <button className="btn btn-secondary btn-small" onClick={cancelInlineEdit}>
                            Peruuta
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="product-name">{meal.name}</div>
                        <div className="product-price">{meal.price}€</div>
                        <div className="content-stack" style={{ gap: 8, marginTop: 12 }}>
                          <button className="btn btn-primary btn-small" onClick={() => startInlineEdit(meal)}>
                            Muokkaa
                          </button>
                          <button className="btn btn-danger btn-small" onClick={() => deleteMeal(meal)}>
                            Poista
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {normalizedMealSearch &&
          buildCategoryGroups(filteredMenu, categories, effectiveMenuCategoryOrder, true).every(
            (category) => category.items.length === 0
          ) ? (
            <p className="muted">Haulla ei löytynyt annoksia.</p>
          ) : null}
        </div>
      </div>
    ),
    "daily-sales": (
      <div className="panel">
        <h2 className="panel-title">Päivän myynti</h2>
        <div className="sales-total-card">
          <div className="sales-total-label">Tuotto tänään</div>
          <div className="sales-total-value">{todaysRevenue.toFixed(2)}€</div>
          <div className="muted">
            {todaysClosedOrders.length} suljettua tilausta tänään
          </div>
          <div className="controls-row" style={{ marginTop: 12 }}>
            <button className="btn btn-danger btn-small" onClick={endDay}>
              Lopeta päivä
            </button>
          </div>
        </div>

        <div className="content-stack" style={{ marginTop: 16 }}>
          <div>
            <h3 className="panel-title">Myydyt annokset</h3>
            {salesSummary.length > 0 ? (
              <div className="sales-list">
                {salesSummary.map((item) => (
                  <div key={`${item.meal}___${item.notes || ""}`} className="sales-item">
                    <div>
                      <div className="sales-item-name">{item.meal}</div>
                      {item.notes ? <div className="muted">Lisätieto: {item.notes}</div> : null}
                      <div className="muted">{item.qty} kpl</div>
                    </div>
                    <div className="sales-item-value">{item.revenue.toFixed(2)}€</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Ei vielä myyntiä tältä päivältä.</p>
            )}
          </div>

          <div>
            <h3 className="panel-title">Menneet tapahtumat</h3>
            {todaysClosedOrders.length > 0 ? (
              <div className="sales-events">
                {todaysClosedOrders.map((order) => (
                  <div key={order.id} className="sales-event order-card menneet">
                    <div className="order-card-head sales-event-head">
                      <div className="cashier-order-main">
                        <span className="order-table">Pöytä {order.table}</span>
                        <span className="cashier-order-badge">
                          {groupOrderItems(order.items || []).length} riviä
                        </span>
                      </div>
                    </div>
                    <div className="sales-event-body">
                      <div className="sales-event-items">
                        {groupOrderItems(order.items || []).map((item, index) => (
                          <div key={index} className="sales-event-item cashier-item-row">
                            <span className="sales-event-item-qty cashier-item-qty">{item.qty}x</span>
                            <span className="sales-event-item-name cashier-item-name">{item.meal}</span>
                            {item.notes ? (
                              <span className="sales-event-item-notes cashier-item-notes">{item.notes}</span>
                            ) : null}
                          </div>
                        ))}
                      </div>
                      <div className="sales-event-times">
                        <div className="sales-time-pill opened">
                          <span className="sales-time-label">Tilaus avattu</span>
                          <span className="sales-time-value">
                            {new Date(order.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })}
                          </span>
                        </div>
                        <div className="sales-time-pill closed">
                          <span className="sales-time-label">Pöytä suljettu</span>
                          <span className="sales-time-value">
                            {new Date(order.closedAt || order.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                              hour12: false,
                            })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="muted">Menneitä tapahtumia ei ole tältä päivältä.</p>
            )}
          </div>
        </div>
      </div>
    ),
  };

  return (
    <div className="screen">
      <ScreenHeader
        title="Admin"
        subtitle="Hallinnoi listaa samassa kortti- ja paneelikielessä kuin kassa ja keittiö, ilman että työnkulku muuttuu."
      />

      <DragDropContext onDragEnd={onAdminDragEnd}>
        <Droppable droppableId="admin-tools" direction="horizontal" type="ADMIN_TOOL">
          {(provided) => (
            <div ref={provided.innerRef} {...provided.droppableProps} className="admin-grid">
              {adminToolOrder.map((panelId, index) => (
                <Draggable key={panelId} draggableId={panelId} index={index}>
                  {(draggableProvided) => (
                    <div
                      ref={draggableProvided.innerRef}
                      {...draggableProvided.draggableProps}
                      className="admin-panel-shell"
                      style={draggableProvided.draggableProps.style}
                    >
                      <div className="admin-panel-toolbar">
                        <div className="admin-panel-handle" {...draggableProvided.dragHandleProps}>
                          {ADMIN_PANEL_TITLES[panelId] || "Paneeli"}
                        </div>
                        <button
                          className="btn btn-secondary btn-small"
                          onClick={() => togglePanelCollapsed(panelId)}
                        >
                          {collapsedPanels[panelId] ? "Avaa" : "Pienennä"}
                        </button>
                      </div>
                      {collapsedPanels[panelId] ? null : adminPanels[panelId]}
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState("Kassa");
  const [menu, setMenu] = useState([]);
  const [categories, setCategories] = useState([]);
  const [adminEntered, setAdminEntered] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState("");
  const adminPassword = useAdminPassword();

  useEffect(() => {
    onValue(ref(db, "menu"), (snapshot) => {
      const data = snapshot.val() || {};
      setMenu(
        Object.entries(data)
          .map(([id, value]) => ({ id, ...value }))
          .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      );
    });
  }, []);

  useEffect(() => {
    onValue(ref(db, "categories"), (snapshot) => {
      const data = snapshot.val() || {};
      setCategories(
        Object.entries(data)
          .map(([id, value]) => ({ id, ...value }))
          .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
      );
    });
  }, []);

  const enterAdmin = () => {
    if (adminPasswordInput === adminPassword) {
      setAdminEntered(true);
    } else {
      alert("Väärä salasana!");
    }
    setAdminPasswordInput("");
  };

  if (view === "Admin" && !adminEntered) {
    return (
      <div className="app-shell">
        <Navigation view={view} setView={setView} />
        <div className="login-shell">
          <div className="panel login-card">
            <ScreenHeader
              title="Admin"
              subtitle="Kirjaudu sisään hallitaksesi ruokalistaa samalla käyttöliittymällä kuin muissa näkymissä."
            />
            <div className="content-stack">
              <div className="field-group">
                <label>Salasana</label>
                <input
                  className="input"
                  type="password"
                  placeholder="Salasana"
                  value={adminPasswordInput}
                  onChange={(event) => setAdminPasswordInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      enterAdmin();
                    }
                  }}
                />
              </div>
              <div className="login-actions">
                <button className="btn btn-primary" onClick={enterAdmin}>
                  Kirjaudu
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Navigation view={view} setView={setView} />
      {view === "Kassa" ? <CashierApp menu={menu} categories={categories} /> : null}
      {view === "Keittiö" ? <KitchenApp /> : null}
      {view === "Admin" && adminEntered ? <AdminApp menu={menu} categories={categories} /> : null}
    </div>
  );
}
