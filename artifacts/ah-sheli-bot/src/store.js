// store.js - Complete code

// 1. הגדרת משתנים או מצב התחלתי
let pendingList = [];

// 2. פונקציה לקבלת הרשימה הממתינה
export function getPendingListAction() {
    return pendingList;
}

// 3. פונקציות עזר נוספות אם נדרשות בקוד שלך
export function setPendingList(newList) {
    pendingList = newList;
}

export function addPendingItem(item) {
    pendingList.push(item);
}
