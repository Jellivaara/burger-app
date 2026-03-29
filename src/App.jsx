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
const ADMIN_TOOL_PANELS = ["meal-form", "category-manager", "menu-list"];

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

function normalizeCategoryId(categoryId) {
  return categoryId || UNCATEGORIZED_ID;
}

function buildCategoryGroups(menu, categories, categoryOrder = []) {
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
    .filter((category) => category.items.length > 0);
}

function ScreenHeader({ title, subtitle }) {
  return (
    <div className="screen-header">
      <div>
        <h1 className="screen-title">{title}</h1>
        {subtitle ? <p className="screen-subtitle">{subtitle}</p> : null}
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
  const [editingId, setEditingId] = useState(null);
  const [newOrderMode, setNewOrderMode] = useState(false);
  const [orderChanged, setOrderChanged] = useState(false);
  const [menuCategoryOrder, setMenuCategoryOrder] = useState([]);
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
        if (editingId || newOrderMode || !occupiedTables.includes(previous)) {
          return previous;
        }

        return TABLE_OPTIONS.find((candidate) => !occupiedTables.includes(candidate)) || previous;
      });
    });
  }, [editingId, newOrderMode]);

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
    setEditingId(null);
    setNewOrderMode(true);
    setOrderChanged(false);
    setTimeout(() => editRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const saveOrder = () => {
    if (currentOrder.length === 0) {
      alert("Tilauksessa ei ole annoksia!");
      return;
    }

    const existingOrder = editingId ? orders.find((order) => order.id === editingId) : null;
    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const data = {
      table,
      items: currentOrder,
      status: existingOrder?.status || "waiting",
      updated: Boolean(editingId),
      createdAt: existingOrder?.createdAt || now,
      orderIndex: existingOrder?.orderIndex || now,
    };

    if (editingId) {
      update(ref(db, `orders/${editingId}`), data);
    } else {
      push(ref(db, "orders"), data);
    }

    const nextAvailableTable = editingId ? table : getNextAvailableTable();
    setCurrentOrder([]);
    setEditingId(null);
    setNewOrderMode(false);
    setOrderChanged(false);
    if (nextAvailableTable) {
      setTable(nextAvailableTable);
    }
  };

  const cancelEdit = () => {
    setCurrentOrder([]);
    setEditingId(null);
    setNewOrderMode(false);
    setOrderChanged(false);
  };

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

    setEditingId(order.id);
    setCurrentOrder(order.items || []);
    setTable(order.table);
    setNewOrderMode(true);
    setOrderChanged(false);
    setTimeout(() => editRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  const addToOrderFromMenu = (mealId) => {
    const mealObj = menu.find((meal) => meal.id === mealId);
    if (!mealObj) {
      return;
    }

    setCurrentOrder((previous) => {
      setOrderChanged(true);
      return [...previous, { mealId, meal: mealObj.name, notes: "", qty: 1 }];
    });
  };

  const deleteWholeOrder = () => {
    if (
      editingId &&
      window.confirm("Oletko varma että haluat poistaa koko tilauksen? Tämä poistaa sen pysyvästi.")
    ) {
      remove(ref(db, `orders/${editingId}`));
      setCurrentOrder([]);
      setEditingId(null);
      setNewOrderMode(false);
      setOrderChanged(false);
    }
  };

  const closeTable = (order) => {
    if (
      window.confirm(
        "Haluatko sulkea pöydän? Tämä siirtää tilauksen menneisiin tilauksiin ja vapauttaa pöydän."
      )
    ) {
      update(ref(db, `orders/${order.id}`), { status: "menneet" });
      setTable((previous) => (previous === order.table ? "1" : previous));
    }
  };

  const categoriesDefault = ["waiting", "cooking", "ready", "poydassa", "menneet"];
  const [categoryOrder, setCategoryOrder] = useState(categoriesDefault);

  const groupedOrders = categoryOrder.reduce((accumulator, status) => {
    accumulator[status] = orders
      .filter((order) => order.status === status)
      .sort((left, right) => (left.orderIndex || 0) - (right.orderIndex || 0));
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

  const menuGroups = buildCategoryGroups(menu, categories, menuCategoryOrder);

  return (
    <div className="screen">
      <ScreenHeader
        title="Kassa"
        subtitle="Luo, muokkaa ja seuraa pöytätilauksia samalla visuaalisella rytmillä kuin keittiössä."
      />

      <div className="content-stack">
        {!newOrderMode && !editingId ? (
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

        {newOrderMode || editingId ? (
          <div ref={editRef} className="panel">
            <h2 className="panel-title row">
              <span className="panel-title-accent">{editingId ? "Muokkaa tilausta" : "Uusi tilaus"}</span>
              <span className="panel-title-muted">Pöytä {table}</span>
            </h2>

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
                            <div className="menu-category-header" {...draggableProvided.dragHandleProps}>
                              <h3 className="panel-title">{category.name}</h3>
                              <span className="menu-category-hint">Vedä kategoriaa</span>
                            </div>
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
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </DragDropContext>

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
                {editingId && currentOrder.length > 0 ? (
                  <div className="order-item-row" style={{ marginTop: 8 }}>
                    <div className="order-item-main" />
                    <div className="order-item-notes" />
                    <button className="btn btn-danger btn-small" onClick={deleteWholeOrder}>
                      Poista koko tilaus
                    </button>
                  </div>
                ) : null}
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
                            <h2 className="panel-title" {...draggableProvided.dragHandleProps}>
                              {statusTitles[status]}
                            </h2>
                            <div className="order-list">
                              {visibleOrders.map((order) => {
                                const groupedItems = groupOrderItems(order.items);

                                return (
                                  <div
                                    key={order.id}
                                    className={`order-card ${status}`}
                                    style={{ background: statusColors[status] || "#fff" }}
                                  >
                                    <div className="order-card-head">
                                      <span className="order-table">Pöytä {order.table}</span>
                                      <span className="order-time">
                                        {new Date(order.createdAt).toLocaleTimeString([], {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        })}
                                      </span>
                                    </div>

                                    <div className="order-actions">
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

                                    {groupedItems.map((item, itemIndex) => (
                                      <div key={itemIndex}>
                                        {item.meal} x{item.qty}{" "}
                                        {item.notes ? <em>({item.notes})</em> : null}
                                      </div>
                                    ))}
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
                  <h2 className="panel-title">{statusTitles[status]}</h2>
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
                                className={`order-card ${status}`}
                                style={draggableProvided.draggableProps.style}
                              >
                                <div className="order-card-head">
                                  <span className="order-table">Pöytä {order.table}</span>
                                  <span className="order-time">
                                    {new Date(order.createdAt).toLocaleTimeString([], {
                                      hour: "2-digit",
                                      minute: "2-digit",
                                    })}
                                  </span>
                                </div>

                                {order.updated ? (
                                  <div className="warning">
                                    Huom! Tilausta muokattu
                                    <button
                                      className="btn btn-secondary btn-small btn-inline"
                                      onClick={() =>
                                        update(ref(db, `orders/${order.id}`), { updated: false })
                                      }
                                    >
                                      Kuittaa
                                    </button>
                                  </div>
                                ) : null}

                                {groupedItems.map((item, itemIndex) => (
                                  <div key={itemIndex}>
                                    {item.meal} x{item.qty}{" "}
                                    {item.notes ? <em>({item.notes})</em> : null}
                                  </div>
                                ))}
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

  const resetForm = () => {
    setEditing(null);
    setName("");
    setPrice("");
    setSelectedCategoryId("");
    setImageFile(null);
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

  const startEdit = (meal) => {
    setEditing(meal);
    setName(meal.name);
    setPrice(meal.price);
    setSelectedCategoryId(meal.categoryId || "");
    setImageFile(null);
  };

  const deleteMeal = (meal) => {
    if (window.confirm("Poista annos?")) {
      remove(ref(db, `menu/${meal.id}`));
    }
  };

  const resetCategoryForm = () => {
    setEditingCategory(null);
    setCategoryName("");
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
    setEditingCategory(category);
    setCategoryName(category.name);
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
    if (editingCategory?.id === category.id) {
      resetCategoryForm();
    }
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
    const grouped = buildCategoryGroups(menu, categories);
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
    nextSourceItems.forEach((meal, index) => {
      updates[`menu/${meal.id}/order`] = index;
      if (sourceCategoryId !== destinationCategoryId && meal.categoryId !== movingMeal.categoryId) {
        updates[`menu/${meal.id}/categoryId`] = meal.categoryId || "";
      }
    });

    nextDestinationItems.forEach((meal, index) => {
      updates[`menu/${meal.id}/order`] = index;
      const nextCategoryId = destinationCategoryId === UNCATEGORIZED_ID ? "" : destinationCategoryId;
      if ((meal.categoryId || "") !== nextCategoryId) {
        updates[`menu/${meal.id}/categoryId`] = nextCategoryId;
      }
    });

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

    if (result.type === "ADMIN_MEAL") {
      await moveMealBetweenCategories(result);
    }
  };

  const adminPanels = {
    "meal-form": (
      <div className="panel">
        <h2 className="panel-title">{editing ? "Muokkaa annosta" : "Lisää uusi annos"}</h2>
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
            {editing ? (
              <button className="btn btn-secondary" onClick={resetForm}>
                Peruuta
              </button>
            ) : null}
          </div>
        </div>
      </div>
    ),
    "category-manager": (
      <div className="panel">
        <h2 className="panel-title">Kategoriat</h2>
        <div className="content-stack">
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
          <div className="controls-row">
            <button className="btn btn-primary" onClick={saveCategory} disabled={categoryLoading}>
              {editingCategory ? "Tallenna kategoria" : "Lisää kategoria"}
            </button>
            {editingCategory ? (
              <button className="btn btn-secondary" onClick={resetCategoryForm}>
                Peruuta
              </button>
            ) : null}
          </div>
          <div className="category-admin-list">
            {categories.map((category) => (
              <div key={category.id} className="category-admin-item">
                <div>
                  <div className="category-admin-name">{category.name}</div>
                  <div className="muted">ID: {category.id}</div>
                </div>
                <div className="controls-row">
                  <button className="btn btn-primary btn-small" onClick={() => startEditCategory(category)}>
                    Muokkaa
                  </button>
                  <button className="btn btn-danger btn-small" onClick={() => deleteCategory(category)}>
                    Poista
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    "menu-list": (
      <div className="panel admin-menu-panel">
        <h2 className="panel-title">Ruokalista</h2>
        <p className="muted" style={{ marginTop: -4, marginBottom: 14 }}>
          Vedä annoksia kategorioiden välillä tai järjestele niitä kategorian sisällä.
        </p>
        <div className="content-stack">
          {buildCategoryGroups(menu, categories, categories.map((category) => category.id)).map((category) => (
            <div key={category.id} className="admin-category-block">
              <h3 className="panel-title">{category.name}</h3>
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
                            <div className="product-name">{meal.name}</div>
                            <div className="product-price">{meal.price}€</div>
                            <div className="content-stack" style={{ gap: 8, marginTop: 12 }}>
                              <button className="btn btn-primary btn-small" onClick={() => startEdit(meal)}>
                                Muokkaa
                              </button>
                              <button className="btn btn-danger btn-small" onClick={() => deleteMeal(meal)}>
                                Poista
                              </button>
                            </div>
                          </div>
                        )}
                      </Draggable>
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            </div>
          ))}
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
                      <div className="admin-panel-handle" {...draggableProvided.dragHandleProps}>
                        Järjestele paneeli
                      </div>
                      {adminPanels[panelId]}
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
