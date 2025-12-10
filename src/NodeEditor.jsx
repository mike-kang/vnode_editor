// NodeEditor.jsx
import React, { useState, useRef } from "react";

function createIdGenerator(prefix) {
  let i = 1;
  return () => `${prefix}_${i++}`;
}

const genNodeId = createIdGenerator("node");
const genPortId = createIdGenerator("port");
const genEdgeId = createIdGenerator("edge");

export default function NodeEditor() {
  // ---------------- 상태 ----------------
  const [nodes, setNodes] = useState(() => [
    {
      id: genNodeId(),
      x: 100,
      y: 100,
      width: 160,
      height: 80,
      title: "Node A",
      inputs: [],   // portId 배열
      outputs: [],  // portId 배열
    },
    {
      id: genNodeId(),
      x: 400,
      y: 250,
      width: 160,
      height: 80,
      title: "Node B",
      inputs: [],
      outputs: [],
    },
  ]);

  const [ports, setPorts] = useState([]);   // { id, nodeId, side }
  const [edges, setEdges] = useState([]);   // { id, fromPortId, toPortId }

  // 포트 드래그로 선 연결 중일 때
  const [draggingConnection, setDraggingConnection] = useState(null);
  // draggingConnection = { fromPortId, x, y }

  // 노드 드래그 중일 때
  const [draggingNode, setDraggingNode] = useState(null);
  // draggingNode = { nodeId, offsetX, offsetY }

  const svgRef = useRef(null);

  // ---------------- 유틸 함수 ----------------
  function getPortById(id) {
    return ports.find((p) => p.id === id);
  }

  // 포트의 화면 상 위치 계산
  function getPortPosition(port) {
    const node = nodes.find((n) => n.id === port.nodeId);
    if (!node) return { x: 0, y: 0 };

    const isLeft = port.side === "left";
    const list = isLeft ? node.inputs : node.outputs;
    const index = list.indexOf(port.id);

    const spacing = 20;
    const startY = node.y + 30; // 타이틀 아래부분부터 배치
    const y = startY + index * spacing;
    const x = isLeft ? node.x : node.x + node.width;

    return { x, y };
  }

  // ---------------- 포트 추가/삭제 ----------------
  function addPort(nodeId, side) {
    const newPortId = genPortId();

    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== nodeId) return n;
        if (side === "left") {
          return { ...n, inputs: [...n.inputs, newPortId] };
        } else {
          return { ...n, outputs: [...n.outputs, newPortId] };
        }
      })
    );

    setPorts((prev) => [
      ...prev,
      {
        id: newPortId,
        nodeId,
        side, // "left" | "right"
      },
    ]);
  }

  function removePort(portId) {
    const port = getPortById(portId);
    if (!port) return;

    // 노드에서 포트 id 제거
    setNodes((prev) =>
      prev.map((n) => {
        if (n.id !== port.nodeId) return n;
        if (port.side === "left") {
          return { ...n, inputs: n.inputs.filter((id) => id !== portId) };
        } else {
          return { ...n, outputs: n.outputs.filter((id) => id !== portId) };
        }
      })
    );

    // 포트 목록에서 제거
    setPorts((prev) => prev.filter((p) => p.id !== portId));

    // 엣지에서 제거
    setEdges((prev) =>
      prev.filter(
        (e) => e.fromPortId !== portId && e.toPortId !== portId
      )
    );
  }

  // ---------------- 엣지(연결) ----------------
  function createEdge(fromPortId, toPortId) {
    const from = getPortById(fromPortId);
    const to = getPortById(toPortId);
    if (!from || !to) return;

    // 같은 방향끼리 연결 금지
    if (from.side === to.side) return;

    // 이미 존재하는지 확인
    const exists = edges.some(
      (e) =>
        (e.fromPortId === fromPortId && e.toPortId === toPortId) ||
        (e.fromPortId === toPortId && e.toPortId === fromPortId)
    );
    if (exists) return;

    // 방향을 left → right로 통일
    let realFrom = from;
    let realTo = to;
    if (from.side === "right") {
      realFrom = to;
      realTo = from;
    }

    setEdges((prev) => [
      ...prev,
      {
        id: genEdgeId(),
        fromPortId: realFrom.id,
        toPortId: realTo.id,
      },
    ]);
  }

  // ---------------- 포트 이벤트 ----------------
  function handlePortMouseDown(e, portId) {
    if (e.button !== 0) return; // 왼쪽 버튼만
    e.stopPropagation();

    const port = getPortById(portId);
    if (!port) return;
    const { x, y } = getPortPosition(port);

    setDraggingConnection({ fromPortId: portId, x, y });
  }

  function handlePortMouseUp(e, portId) {
    e.stopPropagation();
    if (!draggingConnection) return;

    const fromId = draggingConnection.fromPortId;
    if (fromId === portId) {
      setDraggingConnection(null);
      return;
    }

    createEdge(fromId, portId);
    setDraggingConnection(null);
  }

  function handlePortContextMenu(e, portId) {
    e.preventDefault();
    e.stopPropagation();
    removePort(portId);
  }

  // ---------------- 노드 드래그 ----------------
  function handleNodeMouseDown(e, nodeId) {
    if (e.button !== 0) return; // 왼쪽 버튼만
    e.stopPropagation();

    const svg = svgRef.current;
    if (!svg) return;

    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursor = pt.matrixTransform(svg.getScreenCTM().inverse());

    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;

    const offsetX = cursor.x - node.x;
    const offsetY = cursor.y - node.y;

    setDraggingNode({ nodeId, offsetX, offsetY });
  }

  // ---------------- SVG 배경 마우스 이벤트 ----------------
  function handleSvgMouseMove(e) {
    const svg = svgRef.current;
    if (!svg) return;

    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const cursor = pt.matrixTransform(svg.getScreenCTM().inverse());

    // 포트 드래그 중이면 임시 선 위치 갱신
    if (draggingConnection) {
      setDraggingConnection((prev) =>
        prev ? { ...prev, x: cursor.x, y: cursor.y } : null
      );
    }

    // 노드 드래그 중이면 노드 위치 갱신
    if (draggingNode) {
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== draggingNode.nodeId) return n;
          return {
            ...n,
            x: cursor.x - draggingNode.offsetX,
            y: cursor.y - draggingNode.offsetY,
          };
        })
      );
    }
  }

  function handleSvgMouseUp() {
    if (draggingConnection) setDraggingConnection(null);
    if (draggingNode) setDraggingNode(null);
  }

  // ---------------- 노드 추가 버튼 ----------------
  function handleAddNode() {
    setNodes((prev) => [
      ...prev,
      {
        id: genNodeId(),
        x: 250,
        y: 400,
        width: 160,
        height: 80,
        title: "New Node",
        inputs: [],
        outputs: [],
      },
    ]);
  }

  // ---------------- 렌더링 ----------------
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#1e1e1e",
        color: "#eee",
        fontFamily: "sans-serif",
      }}
    >
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #333",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <button onClick={handleAddNode}>노드 추가</button>
        <span style={{ fontSize: 12, opacity: 0.8 }}>
          - 노드 좌/우 '+' 클릭: 포트 추가<br />
          - 포트 좌클릭 드래그 → 다른 쪽 포트에 놓으면 연결<br />
          - 포트 우클릭 → 포트 삭제<br />
          - 노드 본문 드래그 → 노드 이동
        </span>
      </div>

      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ flex: 1, display: "block", background: "#252526" }}
        onMouseMove={handleSvgMouseMove}
        onMouseUp={handleSvgMouseUp}
      >
        {/* 엣지(선) */}
        {edges.map((edge) => {
          const from = getPortById(edge.fromPortId);
          const to = getPortById(edge.toPortId);
          if (!from || !to) return null;
          const p1 = getPortPosition(from);
          const p2 = getPortPosition(to);

          return (
            <line
              key={edge.id}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke="#8be9fd"
              strokeWidth="2"
            />
          );
        })}

        {/* 드래그 중 임시 선 */}
        {draggingConnection && (() => {
          const from = getPortById(draggingConnection.fromPortId);
          if (!from) return null;
          const start = getPortPosition(from);
          const end = { x: draggingConnection.x, y: draggingConnection.y };
          return (
            <line
              x1={start.x}
              y1={start.y}
              x2={end.x}
              y2={end.y}
              stroke="#ffb86c"
              strokeWidth="2"
              strokeDasharray="4 4"
            />
          );
        })()}

        {/* 노드들 */}
        {nodes.map((node) => (
          <g
            key={node.id}
            onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
          >
            {/* 노드 박스 */}
            <rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx="8"
              ry="8"
              fill="#3c3c3c"
              stroke="#555"
              strokeWidth="1"
              style={{ cursor: "move" }}
            />
            {/* 타이틀 */}
            <text
              x={node.x + 8}
              y={node.y + 20}
              fill="#fff"
              fontSize="12"
            >
              {node.title}
            </text>

            {/* 왼쪽 + 버튼 */}
            <g
              onClick={() => addPort(node.id, "left")}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={node.x - 18}
                y={node.y + node.height / 2 - 10}
                width="16"
                height="16"
                rx="3"
                ry="3"
                fill="#007acc"
              />
              <text
                x={node.x - 10}
                y={node.y + node.height / 2 + 1}
                textAnchor="middle"
                alignmentBaseline="middle"
                fill="#fff"
                fontSize="14"
              >
                +
              </text>
            </g>

            {/* 오른쪽 + 버튼 */}
            <g
              onClick={() => addPort(node.id, "right")}
              onMouseDown={(e) => e.stopPropagation()}
              style={{ cursor: "pointer" }}
            >
              <rect
                x={node.x + node.width + 2}
                y={node.y + node.height / 2 - 10}
                width="16"
                height="16"
                rx="3"
                ry="3"
                fill="#007acc"
              />
              <text
                x={node.x + node.width + 10}
                y={node.y + node.height / 2 + 1}
                textAnchor="middle"
                alignmentBaseline="middle"
                fill="#fff"
                fontSize="14"
              >
                +
              </text>
            </g>

            {/* 왼쪽 포트들 */}
            {node.inputs.map((portId) => {
              const port = getPortById(portId);
              if (!port) return null;
              const { x, y } = getPortPosition(port);
              return (
                <circle
                  key={portId}
                  cx={x}
                  cy={y}
                  r="5"
                  fill="#50fa7b"
                  stroke="#111"
                  strokeWidth="1"
                  onMouseDown={(e) => handlePortMouseDown(e, portId)}
                  onMouseUp={(e) => handlePortMouseUp(e, portId)}
                  onContextMenu={(e) => handlePortContextMenu(e, portId)}
                  style={{ cursor: "pointer" }}
                />
              );
            })}

            {/* 오른쪽 포트들 */}
            {node.outputs.map((portId) => {
              const port = getPortById(portId);
              if (!port) return null;
              const { x, y } = getPortPosition(port);
              return (
                <circle
                  key={portId}
                  cx={x}
                  cy={y}
                  r="5"
                  fill="#ff79c6"
                  stroke="#111"
                  strokeWidth="1"
                  onMouseDown={(e) => handlePortMouseDown(e, portId)}
                  onMouseUp={(e) => handlePortMouseUp(e, portId)}
                  onContextMenu={(e) => handlePortContextMenu(e, portId)}
                  style={{ cursor: "pointer" }}
                />
              );
            })}
          </g>
        ))}
      </svg>
    </div>
  );
}
