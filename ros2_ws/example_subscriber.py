#!/usr/bin/env python3
"""
Example subscriber node that subscribes to topics published by the Discovery Node:
1. /agenticros/capabilities (CapabilityManifest)
2. /agenticros/robot_info (RobotInfo)
"""

import sys
import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, DurabilityPolicy

from agenticros_msgs.msg import CapabilityManifest, RobotInfo


class DiscoverySubscriber(Node):
    def __init__(self):
        super().__init__('example_discovery_subscriber')
        
        qos = QoSProfile(depth=1, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        
        self.cap_received = False
        self.info_received = False
        
        self.cap_sub = self.create_subscription(
            CapabilityManifest,
            '/agenticros/capabilities',
            self._on_capabilities,
            qos
        )
        
        self.info_sub = self.create_subscription(
            RobotInfo,
            '/agenticros/robot_info',
            self._on_robot_info,
            qos
        )
        
        self.get_logger().info('Example subscriber node initialized. Listening for discovery messages...')

    def _on_capabilities(self, msg: CapabilityManifest):
        self.cap_received = True
        self.get_logger().info('=== [CapabilityManifest Received] ===')
        self.get_logger().info(f'Robot Name      : {msg.robot_name}')
        self.get_logger().info(f'Robot Namespace : "{msg.robot_namespace}"')
        self.get_logger().info(f'Timestamp       : {msg.stamp.sec}.{msg.stamp.nanosec:09d}s')
        self.get_logger().info(f'Topics ({len(msg.topic_names)})    : {msg.topic_names}')
        self.get_logger().info(f'Services ({len(msg.service_names)}): {msg.service_names}')
        self.get_logger().info(f'Actions ({len(msg.action_names)})  : {msg.action_names}')

    def _on_robot_info(self, msg: RobotInfo):
        self.info_received = True
        self.get_logger().info('=== [RobotInfo Heartbeat Received] ===')
        self.get_logger().info(f'Robot ID        : {msg.id}')
        self.get_logger().info(f'Robot Name      : {msg.name}')
        self.get_logger().info(f'Robot Kind      : {msg.kind}')
        self.get_logger().info(f'Namespace       : "{msg.robot_namespace}"')
        self.get_logger().info(f'Capability IDs  : {msg.capability_ids}')
        self.get_logger().info(f'Sensors         : Realsense={msg.has_realsense}, Lidar={msg.has_lidar}, Arm={msg.has_arm}')
        self.get_logger().info(f'Timestamp       : {msg.stamp.sec}.{msg.stamp.nanosec:09d}s')


def main():
    rclpy.init()
    node = DiscoverySubscriber()
    
    start_time = node.get_clock().now()
    try:
        # Spin until both messages are received or timeout after 10 seconds
        while rclpy.ok():
            rclpy.spin_once(node, timeout_sec=0.5)
            if node.cap_received and node.info_received:
                node.get_logger().info('Successfully received messages from both discovery topics!')
                break
            elapsed = (node.get_clock().now() - start_time).nanoseconds / 1e9
            if elapsed > 10.0:
                node.get_logger().warn('Timed out waiting for discovery messages.')
                break
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
